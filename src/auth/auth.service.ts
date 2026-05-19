import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PublicUser, UsersService } from '../users/users.service';

interface JwtPayload {
  sub: string;
  email: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse extends AuthTokens {
  user: PublicUser;
}

@Injectable()
export class AuthService {
  private readonly BCRYPT_ROUNDS = 10;
  private readonly REFRESH_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30일

  constructor(
    private readonly users: UsersService,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async signup(email: string, password: string, name?: string): Promise<AuthResponse> {
    const normalized = email.toLowerCase();
    const existing = await this.users.findByEmail(normalized);
    if (existing) throw new ConflictException('EMAIL_TAKEN');

    const passwordHash = await bcrypt.hash(password, this.BCRYPT_ROUNDS);
    const user = await this.users.create({ email: normalized, passwordHash, name });

    const tokens = await this.issueTokens(user.id, user.email);
    return { ...tokens, user };
  }

  async login(email: string, password: string): Promise<AuthResponse> {
    const user = await this.users.findByEmail(email.toLowerCase());
    if (!user) throw new UnauthorizedException('EMAIL_NOT_FOUND');

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) throw new UnauthorizedException('WRONG_PASSWORD');

    const publicUser = this.users.toPublic(user);
    const tokens = await this.issueTokens(user.id, user.email);
    return { ...tokens, user: publicUser };
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const tokenHash = this.hashRefreshToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored || stored.revokedAt || stored.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('INVALID_REFRESH_TOKEN');
    }

    // refresh token rotation: 기존 토큰 revoke 후 새 쌍 발급
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const user = await this.users.findByIdOrThrow(stored.userId);
    return this.issueTokens(user.id, user.email);
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = this.hashRefreshToken(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(userId: string, email: string): Promise<AuthTokens> {
    const payload: JwtPayload = { sub: userId, email };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get<string>('JWT_ACCESS_TTL') ?? '15m',
    });

    const refreshToken = randomBytes(48).toString('base64url');
    const tokenHash = this.hashRefreshToken(refreshToken);
    const expiresAt = new Date(Date.now() + this.REFRESH_TTL_MS);

    await this.prisma.refreshToken.create({
      data: { userId, tokenHash, expiresAt },
    });

    return { accessToken, refreshToken };
  }

  private hashRefreshToken(token: string): string {
    // refresh token은 DB에 그대로 두지 않고 해시만 저장한다.
    return createHash('sha256').update(token).digest('hex');
  }
}
