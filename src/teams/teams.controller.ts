import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtUser } from '../auth/strategies/jwt.strategy';
import { TeamsService, type TeamWithMembers } from './teams.service';

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
}
