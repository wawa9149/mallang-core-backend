import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { LunchVote, LunchVoteOption } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateLunchVoteDto } from './dto/create-lunch-vote.dto';

export interface LunchVoteOptionView {
  id: string;
  label: string;
  voteCount: number;
  voters: { id: string; name: string }[];
}

export interface LunchVoteView {
  id: string;
  teamId: string;
  title: string;
  status: LunchVote['status'];
  date: string;
  closesAt: string | null;
  /** 마감된 투표일 때 무작위/최다 득표로 결정된 우승 옵션. open 상태면 null. */
  winnerOptionId: string | null;
  createdAt: string;
  updatedAt: string;
  options: LunchVoteOptionView[];
  myOptionId: string | null;
  totalVotes: number;
}

/** 투표 생성 시 명시적 closesAt이 없으면 적용되는 디폴트 마감 윈도우. */
const DEFAULT_VOTE_WINDOW_MS = 10 * 60 * 1000;

type LunchVoteWithOptions = LunchVote & {
  options: (LunchVoteOption & {
    votes: { userId: string; user: { id: string; name: string } }[];
  })[];
};

@Injectable()
export class LunchVotesService {
  constructor(private readonly prisma: PrismaService) {}

  private async getUserTeamIdOrThrow(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (!user.teamId) {
      throw new BadRequestException(
        '팀에 속해 있지 않아 점심 투표를 사용할 수 없어. 먼저 팀을 설정해 줘.',
      );
    }
    return user.teamId;
  }

  async create(userId: string, input: CreateLunchVoteDto): Promise<LunchVoteView> {
    const teamId = await this.getUserTeamIdOrThrow(userId);

    // 클라이언트가 closesAt을 주지 않았으면 자동으로 시작 + 10분 윈도우로 둔다.
    // 이 윈도우가 지나면 다음 조회 때 lazy auto-close가 발동해 우승자가 확정된다.
    const closesAt = input.closesAt
      ? new Date(input.closesAt)
      : new Date(Date.now() + DEFAULT_VOTE_WINDOW_MS);

    const created = await this.prisma.lunchVote.create({
      data: {
        teamId,
        title: input.title ?? '오늘 점심 뭐 먹지?',
        closesAt,
        options: {
          create: input.options.map((label) => ({ label })),
        },
      },
      include: {
        options: { include: { votes: { include: { user: { select: { id: true, name: true } } } } } },
      },
    });

    return this.toView(created, userId);
  }

  /**
   * 우리 팀의 "현재 화면에서 다뤄야 하는" 점심 투표 목록.
   *
   * - 24시간 이내 생성된 투표 중 가장 최근 1건을 돌려준다.
   * - 진행 중(open)이면 그대로, 마감(closed)이면 winner와 함께 표시할 수 있게 둔다.
   *   → 마감된 직후에도 결과를 계속 볼 수 있고, 다음 투표가 만들어지면 자연스럽게 그쪽이 잡힌다.
   * - 조회 시점에 closesAt이 지난 open 투표는 lazy하게 close로 전환하면서 winner도 확정한다.
   */
  async listActiveForMyTeam(userId: string): Promise<LunchVoteView[]> {
    const teamId = await this.getUserTeamIdOrThrow(userId);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const latest = await this.prisma.lunchVote.findFirst({
      where: { teamId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      include: {
        options: { include: { votes: { include: { user: { select: { id: true, name: true } } } } } },
      },
    });
    if (!latest) return [];
    const resolved = await this.autoCloseIfExpired(latest);
    return [this.toView(resolved, userId)];
  }

  async findById(userId: string, voteId: string): Promise<LunchVoteView> {
    const teamId = await this.getUserTeamIdOrThrow(userId);
    const vote = await this.prisma.lunchVote.findUnique({
      where: { id: voteId },
      include: {
        options: { include: { votes: { include: { user: { select: { id: true, name: true } } } } } },
      },
    });
    if (!vote) throw new NotFoundException('Vote not found');
    if (vote.teamId !== teamId) throw new ForbiddenException('다른 팀의 투표는 볼 수 없어.');
    const refreshed = await this.autoCloseIfExpired(vote);
    return this.toView(refreshed, userId);
  }

  /**
   * 1인 1표를 유지하기 위해 같은 vote에서 내 기존 표를 모두 지우고 새로 기록한다.
   * 옵션 변경(다른 옵션 클릭)도 같은 방식으로 처리된다.
   */
  async cast(userId: string, voteId: string, optionId: string): Promise<LunchVoteView> {
    const teamId = await this.getUserTeamIdOrThrow(userId);

    const vote = await this.prisma.lunchVote.findUnique({
      where: { id: voteId },
      include: { options: true },
    });
    if (!vote) throw new NotFoundException('Vote not found');
    if (vote.teamId !== teamId) throw new ForbiddenException('다른 팀의 투표에는 참여할 수 없어.');
    // 시간 경계에 걸린 케이스도 안전하게 막기 위해 closesAt도 함께 본다.
    if (vote.status !== 'open' || (vote.closesAt && vote.closesAt.getTime() <= Date.now())) {
      throw new BadRequestException('이미 마감된 투표야.');
    }
    const option = vote.options.find((o) => o.id === optionId);
    if (!option) throw new NotFoundException('해당 옵션을 찾을 수 없어.');

    await this.prisma.$transaction([
      this.prisma.lunchVoteOptionVote.deleteMany({
        where: { userId, option: { lunchVoteId: voteId } },
      }),
      this.prisma.lunchVoteOptionVote.create({
        data: { userId, optionId },
      }),
    ]);

    return this.findById(userId, voteId);
  }

  async close(userId: string, voteId: string): Promise<LunchVoteView> {
    const teamId = await this.getUserTeamIdOrThrow(userId);
    const vote = await this.prisma.lunchVote.findUnique({
      where: { id: voteId },
      include: {
        options: { include: { votes: { include: { user: { select: { id: true, name: true } } } } } },
      },
    });
    if (!vote) throw new NotFoundException('Vote not found');
    if (vote.teamId !== teamId) throw new ForbiddenException('다른 팀의 투표는 마감할 수 없어.');
    if (vote.status === 'closed') {
      return this.toView(vote, userId);
    }

    const closed = await this.markClosedWithWinner(vote);
    return this.toView(closed, userId);
  }

  /**
   * closesAt이 지난 open 투표를 close로 전환하고 winner를 확정한다.
   * 이미 close거나, closesAt이 없거나 아직 안 지난 경우는 그대로 반환.
   */
  private async autoCloseIfExpired(
    vote: LunchVoteWithOptions,
  ): Promise<LunchVoteWithOptions> {
    if (vote.status === 'closed') return vote;
    if (!vote.closesAt) return vote;
    if (vote.closesAt.getTime() > Date.now()) return vote;
    return this.markClosedWithWinner(vote);
  }

  /**
   * 최다 득표 옵션을 골라 winner로 기록한다. 동점이면 동점 후보 중 무작위 선택.
   * 옵션이 없거나 모두 0표여도 옵션이 있으면 그 중 무작위로 1개를 winner로 잡는다.
   * (사용자 의도: '아무도 안 골랐어도 점심은 가야 하니 누군가 하나라도 정해줘')
   */
  private async markClosedWithWinner(
    vote: LunchVoteWithOptions,
  ): Promise<LunchVoteWithOptions> {
    let winnerId: string | null = null;
    if (vote.options.length > 0) {
      const maxCount = vote.options.reduce(
        (max, option) => Math.max(max, option.votes.length),
        0,
      );
      const topCandidates = vote.options.filter(
        (option) => option.votes.length === maxCount,
      );
      const picked =
        topCandidates[Math.floor(Math.random() * topCandidates.length)];
      winnerId = picked.id;
    }

    const updated = await this.prisma.lunchVote.update({
      where: { id: vote.id },
      data: { status: 'closed', winnerOptionId: winnerId },
      include: {
        options: { include: { votes: { include: { user: { select: { id: true, name: true } } } } } },
      },
    });
    return updated;
  }

  private toView(vote: LunchVoteWithOptions, userId: string): LunchVoteView {
    let myOptionId: string | null = null;
    let totalVotes = 0;
    const options: LunchVoteOptionView[] = vote.options.map((option) => {
      const voters = option.votes.map((vote) => ({
        id: vote.user.id,
        name: vote.user.name,
      }));
      totalVotes += voters.length;
      if (option.votes.some((v) => v.userId === userId)) {
        myOptionId = option.id;
      }
      return {
        id: option.id,
        label: option.label,
        voteCount: voters.length,
        voters,
      };
    });

    return {
      id: vote.id,
      teamId: vote.teamId,
      title: vote.title,
      status: vote.status,
      date: vote.date.toISOString(),
      closesAt: vote.closesAt ? vote.closesAt.toISOString() : null,
      winnerOptionId: vote.winnerOptionId,
      createdAt: vote.createdAt.toISOString(),
      updatedAt: vote.updatedAt.toISOString(),
      options,
      myOptionId,
      totalVotes,
    };
  }
}
