import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtUser } from '../auth/strategies/jwt.strategy';
import { CastVoteDto } from './dto/cast-vote.dto';
import { CreateLunchVoteDto } from './dto/create-lunch-vote.dto';
import { LunchVotesService, type LunchVoteView } from './lunch-votes.service';

@ApiTags('lunch-votes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('lunch-votes')
export class LunchVotesController {
  constructor(private readonly service: LunchVotesService) {}

  @Post()
  @ApiOkResponse({ description: '새 점심 투표' })
  create(
    @CurrentUser() user: JwtUser,
    @Body() body: CreateLunchVoteDto,
  ): Promise<LunchVoteView> {
    return this.service.create(user.id, body);
  }

  @Get('active')
  @ApiOkResponse({ description: '우리 팀의 진행 중인 점심 투표 목록' })
  active(@CurrentUser() user: JwtUser): Promise<LunchVoteView[]> {
    return this.service.listActiveForMyTeam(user.id);
  }

  @Get(':id')
  @ApiOkResponse({ description: '점심 투표 상세' })
  detail(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
  ): Promise<LunchVoteView> {
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
  close(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
  ): Promise<LunchVoteView> {
    return this.service.close(user.id, id);
  }
}
