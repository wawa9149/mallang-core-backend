import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateReviewDto } from './dto/create-review.dto';

export interface TodayWinnerView {
  lunchVoteId: string;
  restaurantId: string;
  restaurantName: string;
  category: string;
  address: string | null;
  placeUrl: string | null;
}

export interface ReviewView {
  id: string;
  restaurantId: string;
  restaurantName: string;
  rating: number;
  note: string | null;
  wantsAgain: boolean | null;
  visitedAt: string;
}

@Injectable()
export class VisitRecordsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 오늘(KST) 마감된 점심 투표의 winner 식당 정보를 반환한다.
   * winner가 없거나 투표 자체가 없으면 null.
   */
  async getTodayWinner(userId: string): Promise<TodayWinnerView | null> {
    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { teamId: true },
    });
    if (!me?.teamId) return null;

    const todayStart = startOfTodayKst();
    const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    const vote = await this.prisma.lunchVote.findFirst({
      where: {
        teamId: me.teamId,
        status: 'closed',
        date: { gte: todayStart, lt: tomorrowStart },
        winnerOptionId: { not: null },
      },
      include: {
        options: {
          include: { restaurant: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (!vote || !vote.winnerOptionId) return null;

    const winnerOption = vote.options.find(
      (o) => o.id === vote.winnerOptionId,
    );
    if (!winnerOption?.restaurant) return null;

    const r = winnerOption.restaurant;
    return {
      lunchVoteId: vote.id,
      restaurantId: r.id,
      restaurantName: r.name,
      category: r.category,
      address: r.address,
      placeUrl:
        r.source === 'kakao' && r.externalId
          ? `https://place.map.kakao.com/${r.externalId}`
          : null,
    };
  }

  /**
   * 오늘 해당 투표에 대해 이미 리뷰를 남겼는지 확인.
   */
  async hasReviewedToday(
    userId: string,
    lunchVoteId: string,
  ): Promise<boolean> {
    const existing = await this.prisma.visitRecord.findUnique({
      where: {
        userId_lunchVoteId: { userId, lunchVoteId },
      },
      select: { id: true },
    });
    return existing !== null;
  }

  /**
   * 점심 리뷰를 저장한다.
   * - winner 식당에 대한 VisitRecord를 생성/갱신한다.
   * - 이미 리뷰가 있으면 ConflictException.
   */
  async createReview(
    userId: string,
    dto: CreateReviewDto,
  ): Promise<ReviewView> {
    const vote = await this.prisma.lunchVote.findUnique({
      where: { id: dto.lunchVoteId },
      include: {
        options: { include: { restaurant: true } },
      },
    });

    if (!vote) throw new NotFoundException('투표를 찾을 수 없습니다.');
    if (vote.status !== 'closed' || !vote.winnerOptionId) {
      throw new BadRequestException('아직 마감되지 않은 투표입니다.');
    }

    const winnerOption = vote.options.find(
      (o) => o.id === vote.winnerOptionId,
    );
    if (!winnerOption?.restaurant) {
      throw new BadRequestException('우승 식당 정보를 찾을 수 없습니다.');
    }

    const already = await this.hasReviewedToday(userId, dto.lunchVoteId);
    if (already) {
      throw new ConflictException('이미 이 투표에 대한 리뷰를 남겼습니다.');
    }

    const record = await this.prisma.visitRecord.create({
      data: {
        userId,
        restaurantId: winnerOption.restaurant.id,
        lunchVoteId: dto.lunchVoteId,
        rating: dto.rating,
        note: dto.note ?? null,
        wantsAgain: dto.wantsAgain ?? null,
      },
      include: { restaurant: true },
    });

    return {
      id: record.id,
      restaurantId: record.restaurantId,
      restaurantName: record.restaurant.name,
      rating: record.rating!,
      note: record.note,
      wantsAgain: record.wantsAgain,
      visitedAt: record.visitedAt.toISOString(),
    };
  }
}

function startOfTodayKst(): Date {
  const now = new Date();
  const kstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const kstDate = new Date(kstMs);
  const year = kstDate.getUTCFullYear();
  const month = kstDate.getUTCMonth();
  const day = kstDate.getUTCDate();
  return new Date(Date.UTC(year, month, day) - 9 * 60 * 60 * 1000);
}
