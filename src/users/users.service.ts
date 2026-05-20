import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type User } from '@prisma/client';
import { CryptoService } from '../crypto/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdateMeDto } from './dto/update-me.dto';

// 응답에는 passwordHash와 openaiKeyEnc(원문)를 절대 노출하지 않는다.
// 대신 openaiKeyHint(마지막 4자) + openaiKeyUpdatedAt 만 노출한다.
export type PublicUser = Omit<User, 'passwordHash' | 'openaiKeyEnc'> & {
  hasOpenAiKey: boolean;
  openaiKeyHint: string | null;
};

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  }

  async findByIdOrThrow(id: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return this.toPublic(user);
  }

  async create(input: { email: string; passwordHash: string; name?: string }): Promise<PublicUser> {
    const email = input.email.toLowerCase();
    const existing = await this.findByEmail(email);
    if (existing) {
      throw new ConflictException('EMAIL_TAKEN');
    }

    // 닉네임은 온보딩에서 사용자가 직접 채우게 한다.
    // 과거에는 빈 값일 때 email 의 local-part(@ 앞부분) 를 자동으로 박았는데,
    // 사용자가 의도하지 않은 닉네임으로 굳어져 버려 그 동작을 제거했다.
    // schema 상 name 은 NOT NULL 이라 우선 빈 문자열로 두고, updateMe 가 첫 PATCH 에서 채운다.
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash: input.passwordHash,
        name: input.name?.trim() ?? '',
      },
    });
    return this.toPublic(user);
  }

  toPublic(user: User): PublicUser {
    const { passwordHash: _passwordHash, openaiKeyEnc, ...rest } = user;
    const hasOpenAiKey = Boolean(openaiKeyEnc);
    return {
      ...rest,
      hasOpenAiKey,
      openaiKeyHint: hasOpenAiKey ? this.buildKeyHint(openaiKeyEnc) : null,
    };
  }

  /**
   * 사용자 본인이 OpenAI 키를 등록/교체한다. 평문은 절대 DB에 저장하지 않는다.
   */
  async setOpenAiKey(userId: string, plaintext: string): Promise<PublicUser> {
    const trimmed = plaintext.trim();
    if (!trimmed.startsWith('sk-')) {
      throw new BadRequestException('OpenAI API 키는 보통 "sk-"로 시작해. 다시 확인해 줘.');
    }
    const enc = this.crypto.encrypt(trimmed);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        openaiKeyEnc: enc,
        openaiKeyUpdatedAt: new Date(),
      },
    });
    return this.toPublic(updated);
  }

  async clearOpenAiKey(userId: string): Promise<PublicUser> {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        openaiKeyEnc: null,
        openaiKeyUpdatedAt: null,
      },
    });
    return this.toPublic(updated);
  }

  /**
   * ChatService 등이 호출. 키가 없으면 null을 돌려준다.
   */
  async loadOpenAiKey(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { openaiKeyEnc: true },
    });
    if (!user?.openaiKeyEnc) return null;
    try {
      return this.crypto.decrypt(user.openaiKeyEnc);
    } catch {
      return null;
    }
  }

  /**
   * 응답용 마스킹 — 마지막 4자만 노출한다. 복호화에 실패해도 hint 표시는 가능하도록
   * ciphertext의 마지막 4자가 아니라 평문의 마지막 4자를 보여 주려고 시도한다.
   */
  private buildKeyHint(enc: string | null): string | null {
    if (!enc) return null;
    try {
      const plaintext = this.crypto.decrypt(enc);
      const tail = plaintext.slice(-4);
      return `sk-...${tail}`;
    } catch {
      return 'sk-...';
    }
  }

  /**
   * 사용자의 프로필을 부분 업데이트한다.
   * companyName / teamName이 들어오면 회사/팀을 upsert하고 자동으로 합류시킨다.
   *   - 같은 이름의 회사가 이미 있으면 해당 회사에 합류 (회사명 기준 매칭)
   *   - 같은 회사 + 같은 팀명이 이미 있으면 해당 팀에 합류
   *   - 빈 문자열을 보내면 해당 연결을 해제
   *   - companyName을 빈 문자열로 보내면 teamId도 함께 해제 (회사 없는 팀은 이 흐름에선 만들지 않음)
   */
  async updateMe(userId: string, input: UpdateMeDto): Promise<PublicUser> {
    const current = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!current) throw new NotFoundException('User not found');

    const data: Prisma.UserUpdateInput = {};

    if (input.name !== undefined) data.name = input.name;
    if (input.hobby !== undefined) data.hobby = input.hobby;
    if (input.workStartTime !== undefined) data.workStartTime = input.workStartTime;
    if (input.lunchTime !== undefined) data.lunchTime = input.lunchTime;
    if (input.workEndTime !== undefined) data.workEndTime = input.workEndTime;
    if (input.allergies !== undefined) {
      data.allergies = input.allergies === '' ? null : input.allergies;
    }
    if (input.ttsEnabled !== undefined) data.ttsEnabled = input.ttsEnabled;

    let resolvedCompanyId = current.companyId;
    let resolvedTeamId = current.teamId;

    if (input.companyName !== undefined) {
      const trimmed = input.companyName.trim();
      if (trimmed === '') {
        resolvedCompanyId = null;
        resolvedTeamId = null;
      } else {
        // Company.name에는 unique 제약이 없으므로 findFirst로 매칭, 없으면 새로 만든다.
        // 이렇게 해야 같은 회사명을 입력한 사용자끼리 같은 Company 레코드에 모이고,
        // 다른 사용자의 회사 이름을 실수로 갈아엎는 일도 막을 수 있다.
        const existing = await this.prisma.company.findFirst({ where: { name: trimmed } });
        const company = existing ?? (await this.prisma.company.create({ data: { name: trimmed } }));
        if (resolvedCompanyId !== company.id) {
          // 회사가 바뀌면 기존 팀 연결은 자동 해제 (다른 회사 팀에 그대로 두는 건 비논리적).
          resolvedTeamId = null;
        }
        resolvedCompanyId = company.id;
      }
    }

    if (input.teamName !== undefined) {
      const trimmed = input.teamName.trim();
      if (trimmed === '') {
        resolvedTeamId = null;
      } else if (resolvedCompanyId) {
        // 회사가 정해진 경우 (companyId, name) unique 키로 안전하게 upsert.
        const team = await this.prisma.team.upsert({
          where: {
            companyId_name: { companyId: resolvedCompanyId, name: trimmed },
          },
          update: {},
          create: { name: trimmed, companyId: resolvedCompanyId },
        });
        resolvedTeamId = team.id;
      } else {
        // 회사 정보가 없는 사용자도 글로벌 팀명으로 매칭/생성될 수 있게 허용한다.
        // (companyId가 null인 행끼리는 SQL UNIQUE가 충돌하지 않으므로 findFirst 후 fallback.)
        const existing = await this.prisma.team.findFirst({
          where: { companyId: null, name: trimmed },
        });
        const team =
          existing ??
          (await this.prisma.team.create({
            data: { name: trimmed, companyId: null },
          }));
        resolvedTeamId = team.id;
      }
    }

    data.company = resolvedCompanyId
      ? { connect: { id: resolvedCompanyId } }
      : { disconnect: true };
    data.team = resolvedTeamId ? { connect: { id: resolvedTeamId } } : { disconnect: true };

    // 온보딩 완료 시점 박제.
    // - 한 번 채워지면 다시 null 로 돌리지 않는다(사용자가 잠깐 팀명을 비웠다고 온보딩을 다시 시키지 않기 위해).
    // - 처음으로 name + teamId 가 동시에 채워지는 순간을 기준으로 한다.
    const resolvedName = input.name !== undefined ? input.name : current.name;
    if (
      !current.onboardedAt &&
      resolvedName.trim().length > 0 &&
      resolvedTeamId !== null
    ) {
      data.onboardedAt = new Date();
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data,
    });
    return this.toPublic(updated);
  }
}
