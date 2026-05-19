import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  Dietary,
  PriceTier,
  Restaurant,
  RestaurantCategory,
  User,
  UserPreference,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 점심 추천 결과 1건.
 * 프론트의 투표 화면이 이 구조 그대로 카드를 그릴 수 있도록 reason 문자열까지 서버에서 구성한다.
 */
export interface LunchSuggestion {
  restaurantId: string;
  name: string;
  category: RestaurantCategory;
  priceTier: PriceTier;
  rating: number | null;
  tags: string[];
  /** 0~1로 정규화된 최종 점수. 디버깅/정렬용. UI 표시에 직접 쓰지는 않는다. */
  score: number;
  /** "팀 한식 선호 매칭 · 14일 이상 안 감 · 평점 4.4" 같은 한 줄 이유. */
  reason: string;
  /** 탐험 슬롯(=한 번도 안 가본 곳)으로 채워졌는지. UI에서 '새로 가보기' 뱃지에 활용. */
  isExploration: boolean;
  /**
   * 회사 좌표로부터의 직선 거리(미터). 팀 좌표나 식당 좌표가 없으면 null.
   * UI는 표시에만 쓰고, 정렬 자체는 score에 이미 반영돼 있다.
   */
  distanceMeters: number | null;
}

export interface LunchSuggestionResult {
  items: LunchSuggestion[];
  /** UI에 메타로 보여줄 수 있는 안내 메시지(필터가 약해져서 후보가 거의 없었을 때 등). */
  notes: string[];
}

interface TeamMemberContext {
  user: User;
  preference: UserPreference | null;
  /** user.allergies 자유 텍스트를 정규화한 토큰 집합. */
  allergyTokens: Set<string>;
}

interface CandidateScore {
  restaurant: Restaurant;
  score: number;
  breakdown: {
    category: number;
    rating: number;
    price: number;
    freshness: number;
    cooldownPenalty: number;
  };
  daysSinceLastVisit: number | null;
  isExploration: boolean;
  distanceMeters: number | null;
}

/** 최근 N일 안에 팀이 다녀온 식당은 hard filter로 제외 (기본 7일). */
const RECENT_VISIT_BLOCK_DAYS = 7;
/** 어제(24h) 다녀온 카테고리는 soft 패널티만 부여. */
const CATEGORY_COOLDOWN_HOURS = 24;
/** 결정론 단계에서 LLM 단계(추후 Phase 3)에 넘기기 위해 모아두는 후보 수. */
const TOP_K = 20;
/** 최종 사용자에게 보여줄 추천 카드 수. */
const FINAL_PICKS = 3;

const PRICE_TIER_RANK: Record<PriceTier, number> = {
  low: 0,
  mid: 1,
  high: 2,
};

@Injectable()
export class LunchSuggestionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 사용자의 팀 컨텍스트를 기반으로 점심 후보를 반환한다.
   * - LLM은 호출하지 않는다. 모든 점수와 사유는 결정론적으로 계산된다.
   * - 좌표가 없는 팀은 거리 필터를 건너뛴다(추후 geocoding 단계에서 자동 활성화됨).
   */
  async suggest(userId: string): Promise<LunchSuggestionResult> {
    const me = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!me) throw new NotFoundException('User not found');
    if (!me.teamId) {
      return {
        items: [],
        notes: ['팀에 속해 있지 않아 점심 추천을 만들 수 없어. 팀을 먼저 설정해 줘.'],
      };
    }

    const team = await this.prisma.team.findUnique({ where: { id: me.teamId } });
    if (!team) {
      return { items: [], notes: ['팀 정보를 찾을 수 없어.'] };
    }

    const members = await this.prisma.user.findMany({
      where: { teamId: team.id },
      include: { preference: true },
    });

    const memberContexts: TeamMemberContext[] = members.map((member) => ({
      user: member,
      preference: member.preference,
      allergyTokens: parseAllergyTokens(member.allergies),
    }));

    const restaurants = await this.prisma.restaurant.findMany();

    // 우리 팀이 최근 N일 안에 다녀온 식당 IDs.
    // VisitRecord가 없으면 LunchVote.winnerOptionId → option.restaurantId를 통해 보강한다.
    const recentlyVisitedIds = await this.collectRecentlyVisitedIds(team.id);

    // 어제(24h) 다녀온 카테고리 셋. 카테고리 쿨다운 soft 패널티에 사용.
    const cooldownCategories = await this.collectRecentCategories(team.id);

    const notes: string[] = [];

    // 거리 hard-filter는 팀 좌표가 채워져 있을 때만 활성화된다.
    // 좌표가 없는 팀(geocoding 전)이라면 시드 데이터 + 카카오 데이터를 모두 그대로 보여준다.
    // 좌표가 있는 팀이라면, 좌표가 없는 식당(=시드)이나 반경 밖 식당은 제외한다.
    const teamHasCoords = team.lat !== null && team.lng !== null;

    const restaurantsWithDistance: { r: Restaurant; distance: number | null }[] = [];
    for (const r of restaurants) {
      let distance: number | null = null;
      if (teamHasCoords && r.lat !== null && r.lng !== null) {
        distance = haversineMeters(team.lat!, team.lng!, r.lat, r.lng);
      }
      restaurantsWithDistance.push({ r, distance });
    }

    // Hard filter
    const surviving = restaurantsWithDistance.filter(({ r, distance }) => {
      if (teamHasCoords) {
        // 좌표 없는 시드 데이터는 좌표 있는 후보들이 풍부할 때 의도적으로 제외.
        if (distance === null) return false;
        if (distance > team.searchRadiusMeters) return false;
      }
      if (recentlyVisitedIds.has(r.id)) return false;
      if (!isOpenForLunch(r)) return false;
      if (!passesDietary(r, memberContexts)) return false;
      if (!passesAllergies(r, memberContexts)) return false;
      return true;
    });

    if (teamHasCoords && surviving.length === 0) {
      notes.push(
        '회사 좌표 반경 안에서 조건에 맞는 식당이 없어. 반경을 늘리거나 알러지 정보를 확인해 줘.',
      );
    }

    if (surviving.length === 0) {
      if (notes.length === 0) {
        notes.push(
          '조건에 맞는 식당이 없어. 알러지/방문 이력을 한 번 확인하거나 새 식당을 등록해 줘.',
        );
      }
      return { items: [], notes };
    }

    // 각 후보에 대해 마지막 팀 방문일을 계산해 freshness 점수에 반영한다.
    const lastVisitMap = await this.collectLastTeamVisitMap(
      team.id,
      surviving.map(({ r }) => r.id),
    );

    const scored: CandidateScore[] = surviving.map(({ r, distance }) => {
      const lastVisitedAt = lastVisitMap.get(r.id) ?? null;
      const daysSinceLastVisit = daysSince(lastVisitedAt);
      const isExploration = lastVisitedAt === null;
      const breakdown = scoreCandidate({
        restaurant: r,
        members: memberContexts,
        daysSinceLastVisit,
        cooldownCategories,
      });
      const score =
        0.4 * breakdown.category +
        0.2 * breakdown.rating +
        0.2 * breakdown.price +
        0.2 * breakdown.freshness +
        breakdown.cooldownPenalty;
      return {
        restaurant: r,
        score,
        breakdown,
        daysSinceLastVisit,
        isExploration,
        distanceMeters: distance,
      };
    });

    scored.sort((a, b) => b.score - a.score);
    const topK = scored.slice(0, TOP_K);

    const picked = applyDiversityAndExploration(topK, FINAL_PICKS);

    if (picked.length < FINAL_PICKS) {
      notes.push(
        `후보가 적어서 ${picked.length}개만 추천했어. 식당 데이터를 더 늘리면 정확도가 올라가.`,
      );
    }

    return {
      items: picked.map((candidate) => toSuggestion(candidate)),
      notes,
    };
  }

  /**
   * 최근 RECENT_VISIT_BLOCK_DAYS일 안에 팀이 다녀온 식당 ID 집합.
   * - VisitRecord 기반(피드백 단계에서 채워짐) + 마감된 LunchVote.winnerOptionId 보강.
   */
  private async collectRecentlyVisitedIds(teamId: string): Promise<Set<string>> {
    const since = new Date(Date.now() - RECENT_VISIT_BLOCK_DAYS * 24 * 60 * 60 * 1000);

    const [visitRows, voteRows] = await Promise.all([
      this.prisma.visitRecord.findMany({
        where: {
          visitedAt: { gte: since },
          user: { teamId },
        },
        select: { restaurantId: true },
      }),
      this.prisma.lunchVote.findMany({
        where: {
          teamId,
          status: 'closed',
          winnerOptionId: { not: null },
          updatedAt: { gte: since },
        },
        select: {
          winnerOptionId: true,
          options: { select: { id: true, restaurantId: true } },
        },
      }),
    ]);

    const ids = new Set<string>();
    for (const row of visitRows) ids.add(row.restaurantId);
    for (const vote of voteRows) {
      const winner = vote.options.find((opt) => opt.id === vote.winnerOptionId);
      if (winner?.restaurantId) ids.add(winner.restaurantId);
    }
    return ids;
  }

  /** 24h 내 다녀온 카테고리 셋. 카테고리 쿨다운 soft 패널티 용. */
  private async collectRecentCategories(teamId: string): Promise<Set<RestaurantCategory>> {
    const since = new Date(Date.now() - CATEGORY_COOLDOWN_HOURS * 60 * 60 * 1000);
    const visits = await this.prisma.visitRecord.findMany({
      where: { visitedAt: { gte: since }, user: { teamId } },
      include: { restaurant: { select: { category: true } } },
    });
    return new Set(visits.map((v) => v.restaurant.category));
  }

  /**
   * 후보별로 팀이 그 식당에 마지막으로 다녀온 시점.
   * VisitRecord만 본다(=피드백 단계 데이터). 데이터가 쌓이기 전엔 대부분 null이 되어
   * 자연스럽게 "탐험 슬롯" 후보로 분류된다.
   */
  private async collectLastTeamVisitMap(
    teamId: string,
    restaurantIds: string[],
  ): Promise<Map<string, Date>> {
    if (restaurantIds.length === 0) return new Map();
    const visits = await this.prisma.visitRecord.findMany({
      where: {
        restaurantId: { in: restaurantIds },
        user: { teamId },
      },
      orderBy: { visitedAt: 'desc' },
      select: { restaurantId: true, visitedAt: true },
    });
    const map = new Map<string, Date>();
    for (const v of visits) {
      if (!map.has(v.restaurantId)) {
        map.set(v.restaurantId, v.visitedAt);
      }
    }
    return map;
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * 자유 텍스트 알러지를 토큰 집합으로 정규화한다.
 * 쉼표/공백/세미콜론 기준으로 자르고 소문자화한다. 빈 문자열은 무시.
 */
function parseAllergyTokens(raw: string | null): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(/[,;\s]+/)
      .map((token) => token.trim().toLowerCase())
      .filter((token) => token.length > 0),
  );
}

/**
 * 식당의 영업 정보가 점심 시간대에 열리는지 단순 판정.
 * openHours 스키마는 자유 JSON이라 시드 단계에선 모두 통과(=null이면 영업으로 간주)로 둔다.
 * Phase 2(외부 API) 이후 실제 시간 데이터를 채우면 여기서 평가하면 된다.
 */
function isOpenForLunch(_restaurant: Restaurant): boolean {
  return true;
}

/**
 * 팀원 중 한 명이라도 dietary 제한이 있는데 식당이 그걸 지원하지 않으면 탈락.
 * dietary = 'none'이면 무시.
 */
function passesDietary(restaurant: Restaurant, members: TeamMemberContext[]): boolean {
  const required = new Set<Dietary>();
  for (const m of members) {
    const dietary = m.preference?.dietary;
    if (dietary && dietary !== 'none') required.add(dietary);
  }
  for (const need of required) {
    if (!restaurant.dietarySupported.includes(need)) return false;
  }
  return true;
}

/**
 * 식당의 excludedAllergens 토큰이 팀원 누군가의 알러지 토큰과 부분일치하면 탈락.
 * 양방향 부분일치를 모두 본다("새우" vs "갑각류" 둘 다 잡히도록).
 */
function passesAllergies(restaurant: Restaurant, members: TeamMemberContext[]): boolean {
  if (restaurant.excludedAllergens.length === 0) return true;
  const restaurantTokens = restaurant.excludedAllergens.map((t) => t.toLowerCase());
  for (const m of members) {
    for (const userToken of m.allergyTokens) {
      for (const rToken of restaurantTokens) {
        if (rToken.includes(userToken) || userToken.includes(rToken)) {
          return false;
        }
      }
    }
  }
  return true;
}

/**
 * 후보 1개에 대한 점수 분해.
 * 각 항목은 0~1로 정규화되며, 쿨다운 패널티만 음수가 들어간다.
 */
function scoreCandidate(args: {
  restaurant: Restaurant;
  members: TeamMemberContext[];
  daysSinceLastVisit: number | null;
  cooldownCategories: Set<RestaurantCategory>;
}): CandidateScore['breakdown'] {
  const { restaurant, members, daysSinceLastVisit, cooldownCategories } = args;

  const category = scoreCategoryMatch(restaurant.category, members);
  const rating = scoreRating(restaurant.rating);
  const price = scorePrice(restaurant.priceTier, members);
  const freshness = scoreFreshness(daysSinceLastVisit);
  const cooldownPenalty = cooldownCategories.has(restaurant.category) ? -0.15 : 0;

  return { category, rating, price, freshness, cooldownPenalty };
}

/**
 * 카테고리 선호 매칭: 팀원 가중 평균.
 * 개인 점수: preferredCategories에 포함 1, dislikedCategories에 포함 -1, 아니면 0.
 * 가중치: 1 + fairnessScore / 10 (양보 누적이 클수록 가중 ↑).
 * 정규화: [-1, 1] → [0, 1]로 매핑.
 */
function scoreCategoryMatch(category: RestaurantCategory, members: TeamMemberContext[]): number {
  if (members.length === 0) return 0.5;
  let weightedSum = 0;
  let weightTotal = 0;
  for (const m of members) {
    const pref = m.preference;
    const personal = pref
      ? pref.preferredCategories.includes(category)
        ? 1
        : pref.dislikedCategories.includes(category)
          ? -1
          : 0
      : 0;
    const weight = 1 + Math.max(0, pref?.fairnessScore ?? 0) / 10;
    weightedSum += personal * weight;
    weightTotal += weight;
  }
  if (weightTotal === 0) return 0.5;
  const normalized = weightedSum / weightTotal; // [-1, 1]
  return (normalized + 1) / 2; // [0, 1]
}

function scoreRating(rating: number | null): number {
  if (rating === null) return 0.5;
  // 3.0 이하 → 0, 5.0 → 1, 그 사이는 선형.
  return Math.max(0, Math.min(1, (rating - 3) / 2));
}

/**
 * 가격 적합도: 팀의 budgetMax 평균과 priceTier rank의 거리.
 * budgetMax가 모두 없으면 0.6(약간 mid 선호)로 둔다.
 * 매핑: budgetMax <= 10000 → low, <= 20000 → mid, > 20000 → high
 */
function scorePrice(tier: PriceTier, members: TeamMemberContext[]): number {
  const budgets = members
    .map((m) => m.preference?.budgetMax)
    .filter((b): b is number => typeof b === 'number');
  if (budgets.length === 0) {
    return tier === 'mid' ? 0.7 : 0.5;
  }
  const avg = budgets.reduce((s, b) => s + b, 0) / budgets.length;
  const desiredTier: PriceTier = avg <= 10000 ? 'low' : avg <= 20000 ? 'mid' : 'high';
  const distance = Math.abs(PRICE_TIER_RANK[tier] - PRICE_TIER_RANK[desiredTier]);
  if (distance === 0) return 1;
  if (distance === 1) return 0.6;
  return 0.2;
}

/**
 * 신선도: 마지막 방문 후 경과일.
 * - 한 번도 안 갔으면 0.9 (탐험 보너스, 단 1.0은 안 줘서 평점·매칭이 우선되도록).
 * - 8~14일 → 0.4, 15~29일 → 0.7, 30일+ → 1.
 * (0~7일은 hard filter에서 이미 제외됨)
 */
function scoreFreshness(daysSinceLastVisit: number | null): number {
  if (daysSinceLastVisit === null) return 0.9;
  if (daysSinceLastVisit >= 30) return 1;
  if (daysSinceLastVisit >= 15) return 0.7;
  return 0.4;
}

function daysSince(date: Date | null): number | null {
  if (!date) return null;
  return Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * 다양성 보정 + 탐험 슬롯.
 * - 같은 카테고리는 최종 결과에 최대 1개만 허용 (단조롭지 않게).
 * - 마지막 한 자리는 가능한 한 isExploration=true 후보로 채운다.
 *   exploration 후보가 없으면 그냥 차순위 후보를 채운다.
 */
function applyDiversityAndExploration(
  topK: CandidateScore[],
  finalPicks: number,
): CandidateScore[] {
  if (topK.length === 0) return [];
  const usedCategories = new Set<RestaurantCategory>();
  const picked: CandidateScore[] = [];

  // 1) 카테고리 다양성을 유지하며 finalPicks - 1 개를 채운다.
  const exploreSlotCount = 1;
  const diverseSlotCount = Math.max(0, finalPicks - exploreSlotCount);

  for (const candidate of topK) {
    if (picked.length >= diverseSlotCount) break;
    if (usedCategories.has(candidate.restaurant.category)) continue;
    picked.push(candidate);
    usedCategories.add(candidate.restaurant.category);
  }

  // 2) 탐험 슬롯: 아직 안 뽑힌 후보 중 isExploration 우선, 점수순.
  const remaining = topK.filter((c) => !picked.some((p) => p.restaurant.id === c.restaurant.id));
  const exploreCandidate = remaining.find((c) => c.isExploration) ?? remaining[0];
  if (exploreCandidate) picked.push(exploreCandidate);

  // 3) 그래도 finalPicks 미달이면 점수순으로 추가 채우기.
  for (const candidate of remaining) {
    if (picked.length >= finalPicks) break;
    if (picked.some((p) => p.restaurant.id === candidate.restaurant.id)) continue;
    picked.push(candidate);
  }

  return picked.slice(0, finalPicks);
}

function toSuggestion(candidate: CandidateScore): LunchSuggestion {
  const reasonParts: string[] = [];

  if (candidate.distanceMeters !== null) {
    reasonParts.push(formatDistance(candidate.distanceMeters));
  }

  // 카테고리 매칭이 충분히 높으면 그걸 가장 앞에.
  if (candidate.breakdown.category >= 0.7) {
    reasonParts.push(`팀 ${formatCategory(candidate.restaurant.category)} 선호 매칭`);
  }

  if (candidate.isExploration) {
    reasonParts.push('아직 안 가본 곳');
  } else if (candidate.daysSinceLastVisit !== null) {
    if (candidate.daysSinceLastVisit >= 30) {
      reasonParts.push(`${candidate.daysSinceLastVisit}일 만에 다시 가볼 만`);
    } else if (candidate.daysSinceLastVisit >= 15) {
      reasonParts.push(`${candidate.daysSinceLastVisit}일 만에 한 번 더`);
    }
  }

  if (candidate.restaurant.rating !== null && candidate.restaurant.rating >= 4.3) {
    reasonParts.push(`평점 ${candidate.restaurant.rating.toFixed(1)}`);
  }

  if (reasonParts.length === 0) {
    reasonParts.push(`${formatCategory(candidate.restaurant.category)} 한 끼`);
  }

  return {
    restaurantId: candidate.restaurant.id,
    name: candidate.restaurant.name,
    category: candidate.restaurant.category,
    priceTier: candidate.restaurant.priceTier,
    rating: candidate.restaurant.rating,
    tags: candidate.restaurant.tags,
    score: Number(candidate.score.toFixed(3)),
    reason: reasonParts.join(' · '),
    isExploration: candidate.isExploration,
    distanceMeters: candidate.distanceMeters === null ? null : Math.round(candidate.distanceMeters),
  };
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

/**
 * 두 좌표 사이의 Haversine 거리(미터). 점심 추천 범위(수 km)에서는 충분히 정확하다.
 * 외부 지오 라이브러리 없이 직접 구현.
 */
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function formatCategory(category: RestaurantCategory): string {
  switch (category) {
    case 'korean':
      return '한식';
    case 'japanese':
      return '일식';
    case 'chinese':
      return '중식';
    case 'western':
      return '양식';
    case 'asian':
      return '아시안';
    case 'snack':
      return '분식';
    case 'cafe':
      return '브런치/카페';
    default:
      return '추천 메뉴';
  }
}
