import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtUser } from '../auth/strategies/jwt.strategy';
import { CreateReviewDto } from './dto/create-review.dto';
import {
  VisitRecordsService,
  type ReviewView,
  type TodayWinnerView,
} from './visit-records.service';

@ApiTags('visit-records')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('visit-records')
export class VisitRecordsController {
  constructor(private readonly service: VisitRecordsService) {}

  @Get('today-winner')
  @ApiOkResponse({
    description:
      '오늘(KST) 마감된 점심 투표의 우승 식당 정보. 없으면 null.',
  })
  todayWinner(
    @CurrentUser() user: JwtUser,
  ): Promise<TodayWinnerView | null> {
    return this.service.getTodayWinner(user.id);
  }

  @Get('reviewed')
  @ApiOkResponse({
    description: '해당 투표에 대해 이미 리뷰를 남겼는지 확인.',
  })
  async hasReviewed(
    @CurrentUser() user: JwtUser,
    @Query('lunchVoteId') lunchVoteId: string,
  ): Promise<{ reviewed: boolean }> {
    const reviewed = await this.service.hasReviewedToday(
      user.id,
      lunchVoteId,
    );
    return { reviewed };
  }

  @Post()
  @ApiOkResponse({ description: '점심 리뷰 저장' })
  create(
    @CurrentUser() user: JwtUser,
    @Body() dto: CreateReviewDto,
  ): Promise<ReviewView> {
    return this.service.createReview(user.id, dto);
  }
}
