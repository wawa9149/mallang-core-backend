import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService, type PublicUser } from '../users/users.service';

export interface TeamWithMembers {
  team: {
    id: string;
    name: string;
    companyId: string | null;
  } | null;
  members: PublicUser[];
}

@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  /**
   * 내가 속한 팀과 같은 팀 멤버 목록을 반환한다.
   * 팀이 지정되지 않았다면 team=null, members=[]를 반환한다.
   */
  async findMyTeamMembers(userId: string): Promise<TeamWithMembers> {
    const me = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!me) throw new NotFoundException('User not found');

    if (!me.teamId) {
      return { team: null, members: [] };
    }

    const team = await this.prisma.team.findUnique({ where: { id: me.teamId } });
    if (!team) {
      return { team: null, members: [] };
    }

    const rawMembers = await this.prisma.user.findMany({
      where: { teamId: team.id },
      orderBy: { name: 'asc' },
    });

    return {
      team: {
        id: team.id,
        name: team.name,
        companyId: team.companyId,
      },
      members: rawMembers.map((member) => this.users.toPublic(member)),
    };
  }
}
