import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtUser } from '../auth/strategies/jwt.strategy';
import type { SyncResult } from '../restaurants/restaurant-sync.service';
import { UpdateTeamLocationDto } from './dto/update-team-location.dto';
import { TeamsService, type TeamSummary, type TeamWithMembers } from './teams.service';

@ApiTags('teams')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get('me/members')
  @ApiOkResponse({
    description: '내가 속한 팀의 멤버 목록. 팀이 없으면 team=null, members=[]',
  })
  getMyTeamMembers(@CurrentUser() user: JwtUser): Promise<TeamWithMembers> {
    return this.teams.findMyTeamMembers(user.id);
  }

  @Patch('me/location')
  @ApiOkResponse({
    description:
      '내가 속한 팀의 회사/사무실 위치 메타를 갱신한다. 주소가 바뀌면 카카오 geocoding으로 좌표를 채우고, 좌표가 채워지면 백그라운드로 주변 식당을 동기화한다.',
  })
  updateMyTeamLocation(
    @CurrentUser() user: JwtUser,
    @Body() dto: UpdateTeamLocationDto,
  ): Promise<TeamSummary> {
    return this.teams.updateMyTeamLocation(user.id, dto);
  }

  @Post('me/restaurants/sync')
  @ApiOkResponse({
    description:
      '팀 좌표 기준으로 주변 식당을 카카오 Local API에서 다시 가져와 동기화한다(수동 트리거).',
  })
  syncMyTeamRestaurants(@CurrentUser() user: JwtUser): Promise<SyncResult> {
    return this.teams.syncRestaurantsForMyTeam(user.id);
  }
}
