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
  /**
   * 식당 상세 페이지(공유 링크) URL. 카카오 소스이고 externalId 가 있을 때만 채워진다.
   * 시드 데이터처럼 외부 ID 가 없는 식당은 null 이며, 프론트는 이때 이름/주소 검색 URL 로 폴백한다.
   */
  placeUrl: string | null;
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

/**
 * "lunch_alert 윈도우" 길이.
 *
 * 오늘 우리 팀의 점심 투표가 이미 존재하더라도, 아래 조건을 모두 만족할 때는
 * 옵션을 다시 그려준다(replan).
 *  1) 투표가 아직 open 상태
 *  2) 아직 아무도 표를 던지지 않은 상태(총 0표)
 *  3) 현재 시각이 [lunchTime - REPLAN_WINDOW_MS, lunchTime] 사이
 *
 * 동기: 팀원 중 누군가가 점심 시간 한참 전(예: 오전)에 별창을 띄워서 투표가
 * 박제되어 버리면, 본인이 점심 직전에 알러지/dietary 등을 바꿔도 옵션에 반영되지 않는다.
 * lunch_alert 시점(점심 10분 전)에 별창이 자동으로 떠서 ensureAuto 가 다시 호출되므로,
 * 이 시점에 한 번 더 그날의 최신 사용자 선호 기준으로 옵션을 갱신하면 자연스럽다.
 *
 * 윈도우를 20분으로 잡으면 사용자가 시간 설정 변경 등으로 점심 시간이 살짝 어긋나도
 * 안전하게 잡힌다.
 */
const REPLAN_WINDOW_MS = 20 * 60 * 1000;

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

    // 오늘 KST 기준 우리 팀의 가장 최근 투표를 본다. 이미 있으면 그걸 그대로 반환(=멱등).
    // 단, lunch_alert 윈도우 안이고 아직 0표라면 옵션만 새로 그려서 그날의 최신 사용자 선호를 반영한다.
    const todayStart = startOfTodayKst();
    const existing = await this.prisma.lunchVote.findFirst({
      where: { teamId: me.teamId, createdAt: { gte: todayStart } },
      orderBy: { createdAt: 'desc' },
      include: VOTE_INCLUDE,
    });
    if (existing) {
      const refreshed = await this.autoCloseIfExpired(existing);
      const replanned = await this.maybeReplanOptions(refreshed, {
        userId: me.id,
        lunchTime: me.lunchTime,
      });
      return { vote: this.toView(replanned.vote, userId), notes: replanned.notes };
    }

    // 결정론 추천 받기.
    const suggestion = await this.suggestions.suggest(userId);
    if (suggestion.items.length === 0) {
      return { vote: null, notes: suggestion.notes };
    }

    const closesAt = await this.getTeamEarliestLunchTimeTodayKst(me.teamId);
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
   * 오늘 우리 팀 투표의 옵션을 "lunch_alert 윈도우 안 + 0표" 조건일 때만 다시 그린다.
   *
   *  - status 가 closed/open 둘 다 호출되지만, closed 면 즉시 그대로 반환한다.
   *  - 0표 검증은 두 번 한다: 메서드 진입 시 + 트랜잭션 안에서 한 번 더.
   *    그 사이에 누군가 표를 던졌다면 옵션을 건드리지 않는다.
   *  - 추천이 0개를 돌려주면 기존 옵션을 그대로 둔다(빈 투표가 되는 사용자 경험을 막기 위함).
   *  - 옵션 교체와 함께 closesAt 도 그날의 최신 lunchTime 으로 갱신한다.
   *    사용자가 점심 시간 자체를 변경했을 수도 있어서 이 시점에 맞춰 두면 자연스럽다.
   *
   * 반환: 갱신된 vote(또는 갱신하지 않은 vote) 와 함께, suggestion 의 notes 를 그대로 전달한다.
   * 호출 측은 그 notes 를 사용자 UI 에 안내 문구로 띄울 수 있다.
   */
  private async maybeReplanOptions(
    vote: LunchVoteWithOptions,
    me: { userId: string; lunchTime: string },
  ): Promise<{ vote: LunchVoteWithOptions; notes: string[] }> {
    if (vote.status !== 'open') return { vote, notes: [] };

    // 1차 검증: 메서드 진입 시 0표인지.
    const totalVotes = vote.options.reduce((sum, opt) => sum + opt.votes.length, 0);
    if (totalVotes > 0) return { vote, notes: [] };

    // 점심 시간 ±윈도우 안에 들어왔는지.
    const lunchTime = lunchTimeTodayKst(me.lunchTime);
    const now = Date.now();
    const inWindow =
      now >= lunchTime.getTime() - REPLAN_WINDOW_MS && now <= lunchTime.getTime();
    if (!inWindow) return { vote, notes: [] };

    // 새 추천을 받아온다. 추천이 0개면 기존 그대로 둔다.
    const suggestion = await this.suggestions.suggest(me.userId);
    if (suggestion.items.length === 0) {
      return { vote, notes: suggestion.notes };
    }

    // 트랜잭션 내에서 다시 한 번 "여전히 open + 0표" 인지 확인하고 옵션을 교체한다.
    // 그 사이 누군가 표를 던졌으면 사용자 표 의도를 보호하기 위해 교체를 포기한다.
    const replanned = await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.lunchVote.findUnique({
        where: { id: vote.id },
        include: { options: { include: { votes: true } } },
      });
      if (!fresh) return null;
      if (fresh.status !== 'open') return null;
      const totalNow = fresh.options.reduce((sum, opt) => sum + opt.votes.length, 0);
      if (totalNow > 0) return null;

      // 기존 옵션 모두 삭제(cascade 로 0개의 표가 같이 정리되지만 어차피 0표라 무해).
      await tx.lunchVoteOption.deleteMany({ where: { lunchVoteId: vote.id } });

      return tx.lunchVote.update({
        where: { id: vote.id },
        data: {
          // 점심 시간 자체가 변경됐을 가능성을 반영해 마감 시각도 최신으로.
          closesAt: lunchTime,
          options: {
            create: suggestion.items.map((item) => ({
              label: item.name,
              restaurantId: item.restaurantId,
              reason: item.reason,
            })),
          },
        },
        include: VOTE_INCLUDE,
      });
    });

    if (!replanned) {
      // 그 사이 누가 표를 던졌거나 vote 가 close 됐다면 원본 그대로.
      return { vote, notes: [] };
    }
    return { vote: replanned, notes: suggestion.notes };
  }

  /**
   * 자동 점심 투표의 마감 시각은 "첫 요청자"가 아니라 팀원 중 가장 빠른 lunchTime 기준으로 잡는다.
   *
   * 프론트 스케줄러도 팀원 중 가장 빠른 lunchTime - 10분에 모두에게 lunch_alert 를 띄운다.
   * 이때 여러 PC가 거의 동시에 POST /lunch-votes/auto 를 호출할 수 있는데, 늦은 점심 시간 사용자의
   * 요청이 먼저 도착하더라도 투표 마감이 늦은 시간으로 밀리면 정책과 어긋난다.
   * 따라서 생성 시점에서도 팀 전체의 가장 빠른 lunchTime 을 다시 계산해 서버 측 진실로 사용한다.
   */
  private async getTeamEarliestLunchTimeTodayKst(teamId: string): Promise<Date> {
    const members = await this.prisma.user.findMany({
      where: { teamId },
      select: { lunchTime: true },
    });
    const lunchTimes = members
      .map((member) => member.lunchTime)
      .filter(isValidHHMM)
      .sort(compareHHMM);
    return lunchTimeTodayKst(lunchTimes[0] ?? '12:30');
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
            placeUrl: buildPlaceUrl(
              option.restaurant.source,
              option.restaurant.externalId,
            ),
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
 * 식당 row 의 source/externalId 로 외부 상세 페이지(공유 링크) URL 을 만든다.
 * - 카카오에서 가져온 식당: `https://place.map.kakao.com/{externalId}` 형태의 정식 상세 페이지.
 * - 그 외 소스(시드 등)나 externalId 가 없는 경우 null. 프론트는 검색 URL 로 폴백한다.
 */
function buildPlaceUrl(
  source: string,
  externalId: string | null,
): string | null {
  if (!externalId) return null;
  if (source === 'kakao') {
    return `https://place.map.kakao.com/${encodeURIComponent(externalId)}`;
  }
  return null;
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

function isValidHHMM(value: string | null | undefined): value is string {
  if (!value) return false;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return false;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

function compareHHMM(a: string, b: string): number {
  return toMinutes(a) - toMinutes(b);
}

function toMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}
