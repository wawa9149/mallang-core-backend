import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { KakaoLocalAdapter } from '../restaurants/kakao/kakao-local.adapter';
import { RestaurantSyncService, type SyncResult } from '../restaurants/restaurant-sync.service';
import { UsersService, type PublicUser } from '../users/users.service';
import type { UpdateTeamLocationDto } from './dto/update-team-location.dto';

export interface TeamLocation {
  address: string | null;
  lat: number | null;
  lng: number | null;
  searchRadiusMeters: number;
}

export interface TeamSummary {
  id: string;
  name: string;
  companyId: string | null;
  location: TeamLocation;
}

export interface TeamWithMembers {
  team: TeamSummary | null;
  members: PublicUser[];
}

@Injectable()
export class TeamsService {
  private readonly logger = new Logger(TeamsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly kakao: KakaoLocalAdapter,
    private readonly restaurantSync: RestaurantSyncService,
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
      team: this.toSummary(team),
      members: rawMembers.map((member) => this.users.toPublic(member)),
    };
  }

  /**
   * 내가 속한 팀의 위치 메타를 갱신한다.
   *
   * 흐름:
   *   1. 주소가 바뀌면 일단 lat/lng를 비우고 DB에 저장(낡은 좌표가 잠시라도 추천에 쓰이지 않도록).
   *   2. 카카오 키가 있으면 즉시 geocoding을 시도. 성공하면 좌표를 채워 다시 저장한다.
   *   3. 좌표가 채워졌으면 같은 트랜잭션 밖에서 주변 식당 동기화를 fire-and-forget으로 시작한다.
   *      응답은 즉시 반환하고, 동기화는 백그라운드에서 흐른다(주변 검색이 1~3초 걸리므로).
   *   4. searchRadiusMeters만 변경된 경우에도 동기화를 한 번 더 돌려준다(반경이 바뀌면 후보가 달라지므로).
   */
  async updateMyTeamLocation(userId: string, dto: UpdateTeamLocationDto): Promise<TeamSummary> {
    const me = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!me?.teamId) throw new NotFoundException('Team not found');
    const teamId = me.teamId;

    const before = await this.prisma.team.findUnique({ where: { id: teamId } });
    const addressChanged =
      dto.address !== undefined && (dto.address ?? null) !== (before?.address ?? null);
    const radiusChanged =
      dto.searchRadiusMeters !== undefined && dto.searchRadiusMeters !== before?.searchRadiusMeters;

    let next = await this.prisma.team.update({
      where: { id: teamId },
      data: {
        ...(dto.address !== undefined
          ? {
              address: dto.address ?? null,
              // 주소가 바뀌면 일단 무효화. geocoding 성공 시 다시 채워진다.
              lat: null,
              lng: null,
            }
          : {}),
        ...(dto.searchRadiusMeters !== undefined
          ? { searchRadiusMeters: dto.searchRadiusMeters }
          : {}),
      },
    });

    // geocoding 재시도 조건:
    //  - 카카오 키가 있고, 주소가 비어 있지 않으며,
    //  - 주소가 새로 바뀐 경우(addressChanged)이거나
    //  - 좌표가 아직 채워지지 않은 경우(이전 시도가 실패했거나 처음 등록 후 미완료).
    // 이렇게 두면 사용자가 "주소 저장"을 다시 누르기만 해도 좌표 백필이 자동으로 재시도된다.
    const coordsMissing = next.lat === null || next.lng === null;
    const shouldGeocode =
      this.kakao.isEnabled() && !!next.address && (addressChanged || coordsMissing);
    if (shouldGeocode) {
      try {
        const coords = await this.kakao.geocode(next.address!);
        if (coords) {
          next = await this.prisma.team.update({
            where: { id: teamId },
            data: { lat: coords.lat, lng: coords.lng },
          });
        } else {
          this.logger.warn(
            `[teams] geocoding empty result for team=${teamId} address="${next.address}"`,
          );
        }
      } catch (err) {
        this.logger.warn(`[teams] geocoding failed team=${teamId} err=${(err as Error).message}`);
      }
    }

    // 동기화 트리거: 좌표가 채워졌고 (주소/반경 변경) 또는 (좌표가 방금 처음 들어옴) 인 경우.
    const justGotCoords = coordsMissing && next.lat !== null && next.lng !== null;
    const shouldSync =
      next.lat !== null && next.lng !== null && (addressChanged || radiusChanged || justGotCoords);
    if (shouldSync) {
      this.fireSyncInBackground(teamId);
    }

    return this.toSummary(next);
  }

  /**
   * 외부에서 (예: 수동 재동기화 엔드포인트) 호출되는 sync 진입점. 결과를 그대로 반환한다.
   */
  syncRestaurantsForMyTeam(userId: string): Promise<SyncResult> {
    return this.prisma.user.findUnique({ where: { id: userId } }).then((me) => {
      if (!me?.teamId) throw new NotFoundException('Team not found');
      return this.restaurantSync.syncForTeam(me.teamId);
    });
  }

  private fireSyncInBackground(teamId: string): void {
    void this.restaurantSync
      .syncForTeam(teamId)
      .then((result) => {
        this.logger.log(
          `[teams] background sync done team=${teamId} fetched=${result.fetched} upserted=${result.upserted}`,
        );
      })
      .catch((err) => {
        this.logger.warn(
          `[teams] background sync failed team=${teamId} err=${(err as Error).message}`,
        );
      });
  }

  private toSummary(team: {
    id: string;
    name: string;
    companyId: string | null;
    address: string | null;
    lat: number | null;
    lng: number | null;
    searchRadiusMeters: number;
  }): TeamSummary {
    return {
      id: team.id,
      name: team.name,
      companyId: team.companyId,
      location: {
        address: team.address,
        lat: team.lat,
        lng: team.lng,
        searchRadiusMeters: team.searchRadiusMeters,
      },
    };
  }
}
