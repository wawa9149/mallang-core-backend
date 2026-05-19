import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtUser } from '../auth/strategies/jwt.strategy';
import { CastVoteDto } from './dto/cast-vote.dto';
import { CreateLunchVoteDto } from './dto/create-lunch-vote.dto';
import { LunchSuggestionService, type LunchSuggestionResult } from './lunch-suggestion.service';
import { LunchVotesService, type LunchVoteView } from './lunch-votes.service';

@ApiTags('lunch-votes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('lunch-votes')
export class LunchVotesController {
  constructor(
    private readonly service: LunchVotesService,
    private readonly suggestions: LunchSuggestionService,
  ) {}

  @Get('suggestions')
  @ApiOkResponse({
    description:
      '내가 속한 팀 기준 점심 추천 Top-3. 결정론 파이프라인만 사용하며 LLM은 호출하지 않는다.',
  })
  suggest(@CurrentUser() user: JwtUser): Promise<LunchSuggestionResult> {
    return this.suggestions.suggest(user.id);
  }

  @Post('auto')
  @ApiOkResponse({
    description:
      '오늘(KST) 우리 팀의 점심 투표를 멱등하게 보장한다. 이미 있으면 그대로, 없으면 추천 Top-3로 자동 생성하고 closesAt은 사용자의 lunchTime으로 설정한다.',
  })
  ensureAuto(@CurrentUser() user: JwtUser): Promise<{
    vote: LunchVoteView | null;
    notes: string[];
  }> {
    return this.service.ensureAutoVoteForToday(user.id);
  }

  @Post()
  @ApiOkResponse({ description: '새 점심 투표' })
  create(@CurrentUser() user: JwtUser, @Body() body: CreateLunchVoteDto): Promise<LunchVoteView> {
    return this.service.create(user.id, body);
  }

  @Get('active')
  @ApiOkResponse({ description: '우리 팀의 진행 중인 점심 투표 목록' })
  active(@CurrentUser() user: JwtUser): Promise<LunchVoteView[]> {
    return this.service.listActiveForMyTeam(user.id);
  }

  @Get(':id')
  @ApiOkResponse({ description: '점심 투표 상세' })
  detail(@CurrentUser() user: JwtUser, @Param('id') id: string): Promise<LunchVoteView> {
    return this.service.findById(user.id, id);
  }

  @Post(':id/vote')
  @ApiOkResponse({ description: '옵션에 투표. 같은 사용자가 다시 호출하면 이전 표를 갈음한다.' })
  cast(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() body: CastVoteDto,
  ): Promise<LunchVoteView> {
    return this.service.cast(user.id, id, body.optionId);
  }

  @Post(':id/close')
  @ApiOkResponse({ description: '투표를 수동으로 마감한다.' })
  close(@CurrentUser() user: JwtUser, @Param('id') id: string): Promise<LunchVoteView> {
    return this.service.close(user.id, id);
  }
}
