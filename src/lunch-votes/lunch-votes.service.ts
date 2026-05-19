import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  LunchVote,
  LunchVoteOption,
  PriceTier,
  Restaurant,
  RestaurantCategory,
  Team,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateLunchVoteDto } from './dto/create-lunch-vote.dto';
import { haversineMeters } from './geo.util';
import { LunchSuggestionService } from './lunch-suggestion.service';

/**
 * 투표 옵션이 가리키는 식당의 표시용 메타데이터.
 * - 옵션의 restaurantId가 살아 있을 때만 채워진다(자유 입력 옵션이거나 식당이 삭제됐다면 null).
 * - distanceMeters는 옵션 생성 시점에 박제하지 않고, 응답 시점의 team 좌표 기준으로
 *   매번 다시 계산한다. 회사 위치 변경에 즉시 반응시키기 위함이다.
 */
export interface LunchVoteOptionRestaurantView {
  id: string;
  name: string;
  category: RestaurantCategory;
  priceTier: PriceTier;
  rating: number | null;
  tags: string[];
  address: string | null;
  /** 회사 좌표에서의 직선 거리(미터). team 좌표나 식당 좌표가 없으면 null. */
  distanceMeters: number | null;
}

export interface LunchVoteOptionView {
  id: string;
  label: string;
  /** 추천 시스템이 만든 옵션은 식당 row와 연결된다. 자유 입력은 null. */
  restaurantId: string | null;
  voteCount: number;
  voters: { id: string; name: string }[];
  /** 추천 결정론이 옵션을 만든 한 줄 사유. 자유 입력 옵션은 null. */
  reason: string | null;
  /** 옵션이 연결된 식당의 표시용 메타. 자유 입력 또는 식당 삭제 시 null. */
  restaurant: LunchVoteOptionRestaurantView | null;
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
  team: Team;
  options: (LunchVoteOption & {
    restaurant: Restaurant | null;
    votes: { userId: string; user: { id: string; name: string } }[];
  })[];
};

/** 모든 조회/변경에서 동일한 include 트리를 쓰도록 한 곳에 묶어둔다. */
const VOTE_INCLUDE = {
  team: true,
  options: {
    include: {
      restaurant: true,
      votes: { include: { user: { select: { id: true, name: true } } } },
    },
  },
} as const;

@Injectable()
export class LunchVotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly suggestions: LunchSuggestionService,
  ) {}

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

  /**
   * 오늘(KST) 우리 팀의 점심 투표를 멱등하게 보장한다.
   *
   * - 이미 오늘 우리 팀의 투표가 있으면 그것을 그대로 반환(open이든 closed든).
   * - 없으면 결정론 추천(LunchSuggestionService.suggest)으로 후보를 받아 자동 생성한다.
   *   * title 은 항상 기본값 ("오늘 점심 뭐 먹지?")
   *   * options[i].label = suggestion.name, options[i].restaurantId = suggestion.restaurantId
   *   * closesAt = 사용자의 lunchTime이 가리키는 오늘 KST 시각 (예: 12:30)
   * - 후보가 0개면 LunchVote를 만들지 않고 결과를 그대로 전한다(notes 포함).
   *
   * 동시 호출 안전성: 같은 팀이 동시에 두 번 호출해도 unique race가 아니라 단순 createdAt
   * 비교라서 드물게 두 개가 만들어질 수 있다. 그 경우 listActive가 가장 최근 1개만 보여주므로
   * 사용자 노출은 1개로 수렴한다. (운영 단계에서 advisory lock으로 더 단단히 막을 수 있음)
   */
  async ensureAutoVoteForToday(userId: string): Promise<{
    vote: LunchVoteView | null;
    notes: string[];
  }> {
    const me = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!me) throw new NotFoundException('User not found');
    if (!me.teamId) {
      return {
        vote: null,
        notes: ['팀에 속해 있지 않아 점심 투표를 시작할 수 없어. 팀을 먼저 설정해 줘.'],
      };
    }

    // 오늘 KST 기준 우리 팀의 가장 최근 투표를 본다. 이미 있으면 그걸 그대로 반환.
    const todayStart = startOfTodayKst();
    const existing = await this.prisma.lunchVote.findFirst({
      where: { teamId: me.teamId, createdAt: { gte: todayStart } },
      orderBy: { createdAt: 'desc' },
      include: VOTE_INCLUDE,
    });
    if (existing) {
      const refreshed = await this.autoCloseIfExpired(existing);
      return { vote: this.toView(refreshed, userId), notes: [] };
    }

    // 결정론 추천 받기.
    const suggestion = await this.suggestions.suggest(userId);
    if (suggestion.items.length === 0) {
      return { vote: null, notes: suggestion.notes };
    }

    const closesAt = lunchTimeTodayKst(me.lunchTime);
    const created = await this.prisma.lunchVote.create({
      data: {
        teamId: me.teamId,
        title: '오늘 점심 뭐 먹지?',
        closesAt,
        options: {
          create: suggestion.items.map((item) => ({
            label: item.name,
            restaurantId: item.restaurantId,
            // 추천 결정론이 만든 한 줄 사유를 박제해둔다. 이후 다시 추천이 돌아도 옵션의 reason은 변하지 않는다.
            reason: item.reason,
          })),
        },
      },
      include: VOTE_INCLUDE,
    });

    return { vote: this.toView(created, userId), notes: suggestion.notes };
  }

  async create(userId: string, input: CreateLunchVoteDto): Promise<LunchVoteView> {
    const teamId = await this.getUserTeamIdOrThrow(userId);

    // 클라이언트가 closesAt을 주지 않았으면 자동으로 시작 + 10분 윈도우로 둔다.
    // 이 윈도우가 지나면 다음 조회 때 lazy auto-close가 발동해 우승자가 확정된다.
    const closesAt = input.closesAt
      ? new Date(input.closesAt)
      : new Date(Date.now() + DEFAULT_VOTE_WINDOW_MS);

    // restaurantIds가 있으면 인덱스로 짝지어 옵션에 함께 박는다.
    // 길이가 옵션과 다르거나, 빈 문자열인 자리는 자유 입력으로 간주해 null로 저장.
    const optionPayload = input.options.map((label, index) => {
      const restaurantId = input.restaurantIds?.[index];
      const cleaned =
        typeof restaurantId === 'string' && restaurantId.length > 0 ? restaurantId : null;
      return { label, restaurantId: cleaned };
    });

    const created = await this.prisma.lunchVote.create({
      data: {
        teamId,
        title: input.title ?? '오늘 점심 뭐 먹지?',
        closesAt,
        options: {
          create: optionPayload,
        },
      },
      include: VOTE_INCLUDE,
    });

    return this.toView(created, userId);
  }

  /**
   * 우리 팀의 "오늘의" 점심 투표 1건.
   *
   * - 기준: 한국 시간(KST = UTC+9) 자정 이후 생성된 투표.
   *   24시간 슬라이딩 윈도우로 두면 어제 12:30 투표가 오늘 12:30 직전까지도 잡혀버려서
   *   "오늘 아직 투표 안 했는데 어제 결과가 떠 있는" 헷갈리는 상황이 발생하기 때문.
   * - 진행 중(open)이면 그대로, 마감(closed)이면 winner와 함께 표시할 수 있게 둔다.
   *   → 오늘 마감된 직후에도 결과를 계속 볼 수 있고, 자정이 지나면 자연스럽게 사라진다.
   * - 조회 시점에 closesAt이 지난 open 투표는 lazy하게 close로 전환하면서 winner도 확정한다.
   */
  async listActiveForMyTeam(userId: string): Promise<LunchVoteView[]> {
    const teamId = await this.getUserTeamIdOrThrow(userId);
    const since = startOfTodayKst();
    const latest = await this.prisma.lunchVote.findFirst({
      where: { teamId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      include: VOTE_INCLUDE,
    });
    if (!latest) return [];
    const resolved = await this.autoCloseIfExpired(latest);
    return [this.toView(resolved, userId)];
  }

  async findById(userId: string, voteId: string): Promise<LunchVoteView> {
    const teamId = await this.getUserTeamIdOrThrow(userId);
    const vote = await this.prisma.lunchVote.findUnique({
      where: { id: voteId },
      include: VOTE_INCLUDE,
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

    // 팀 전원이 투표를 마쳤다면 정시가 되기 전에도 즉시 마감한다.
    // - "팀원" = vote가 속한 team의 현재 user.teamId 사용자 전원
    // - 한 사람이 옵션을 바꿔 던져도 1표로 카운트되므로(같은 lunchVote 내 userId 유니크) 단순 카운트로 안전
    const teamMembers = await this.prisma.user.findMany({
      where: { teamId: vote.teamId },
      select: { id: true },
    });
    const distinctVoters = await this.prisma.lunchVoteOptionVote.findMany({
      where: { option: { lunchVoteId: voteId } },
      distinct: ['userId'],
      select: { userId: true },
    });
    if (teamMembers.length > 0 && distinctVoters.length >= teamMembers.length) {
      const full = await this.prisma.lunchVote.findUnique({
        where: { id: voteId },
        include: VOTE_INCLUDE,
      });
      if (full && full.status === 'open') {
        const closed = await this.markClosedWithWinner(full);
        return this.toView(closed, userId);
      }
    }

    return this.findById(userId, voteId);
  }

  async close(userId: string, voteId: string): Promise<LunchVoteView> {
    const teamId = await this.getUserTeamIdOrThrow(userId);
    const vote = await this.prisma.lunchVote.findUnique({
      where: { id: voteId },
      include: VOTE_INCLUDE,
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
  private async autoCloseIfExpired(vote: LunchVoteWithOptions): Promise<LunchVoteWithOptions> {
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
  private async markClosedWithWinner(vote: LunchVoteWithOptions): Promise<LunchVoteWithOptions> {
    let winnerId: string | null = null;
    if (vote.options.length > 0) {
      const maxCount = vote.options.reduce((max, option) => Math.max(max, option.votes.length), 0);
      const topCandidates = vote.options.filter((option) => option.votes.length === maxCount);
      const picked = topCandidates[Math.floor(Math.random() * topCandidates.length)];
      winnerId = picked.id;
    }

    const updated = await this.prisma.lunchVote.update({
      where: { id: vote.id },
      data: { status: 'closed', winnerOptionId: winnerId },
      include: VOTE_INCLUDE,
    });
    return updated;
  }

  private toView(vote: LunchVoteWithOptions, userId: string): LunchVoteView {
    const team = vote.team;
    const teamHasCoords = team.lat !== null && team.lng !== null;

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

      const restaurant: LunchVoteOptionRestaurantView | null = option.restaurant
        ? {
            id: option.restaurant.id,
            name: option.restaurant.name,
            category: option.restaurant.category,
            priceTier: option.restaurant.priceTier,
            rating: option.restaurant.rating,
            tags: option.restaurant.tags,
            address: option.restaurant.address,
            distanceMeters:
              teamHasCoords &&
              option.restaurant.lat !== null &&
              option.restaurant.lng !== null
                ? Math.round(
                    haversineMeters(
                      team.lat!,
                      team.lng!,
                      option.restaurant.lat,
                      option.restaurant.lng,
                    ),
                  )
                : null,
          }
        : null;

      return {
        id: option.id,
        label: option.label,
        restaurantId: option.restaurantId,
        voteCount: voters.length,
        voters,
        reason: option.reason,
        restaurant,
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

/**
 * "한국 시간(KST = UTC+9) 기준 오늘 00:00"에 해당하는 Date를 돌려준다.
 *
 * 서버가 어느 타임존에서 돌든 결과가 동일해야 하므로, Intl/toLocale 같은 시스템 의존 API를
 * 쓰지 않고 직접 UTC 오프셋을 계산한다.
 *
 * 예: 지금이 2026-05-19 15:18 KST 라면, 반환값은 2026-05-19 00:00 KST = 2026-05-18 15:00 UTC.
 */
function startOfTodayKst(): Date {
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const nowKstMs = Date.now() + KST_OFFSET_MS;
  const kstNow = new Date(nowKstMs);
  const y = kstNow.getUTCFullYear();
  const m = kstNow.getUTCMonth();
  const d = kstNow.getUTCDate();
  return new Date(Date.UTC(y, m, d, 0, 0, 0, 0) - KST_OFFSET_MS);
}

/**
 * 사용자의 lunchTime("HH:MM")을 "오늘 KST 기준 그 시각"의 Date로 변환한다.
 * 자동 점심 투표의 마감 시각(closesAt)에 사용된다. 형식이 올바르지 않으면
 * 안전한 기본값(오늘 12:30 KST)을 돌려준다.
 */
function lunchTimeTodayKst(hhmm: string): Date {
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  const h = match ? Math.max(0, Math.min(23, Number(match[1]))) : 12;
  const m = match ? Math.max(0, Math.min(59, Number(match[2]))) : 30;
  const nowKstMs = Date.now() + KST_OFFSET_MS;
  const kstNow = new Date(nowKstMs);
  return new Date(
    Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate(), h, m, 0, 0) -
      KST_OFFSET_MS,
  );
}
