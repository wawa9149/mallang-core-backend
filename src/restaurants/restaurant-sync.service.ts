import { Injectable, Logger } from '@nestjs/common';
import type { RestaurantCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { KakaoLocalAdapter } from './kakao/kakao-local.adapter';

export interface SyncResult {
  enabled: boolean;
  fetched: number;
  upserted: number;
  skipped: number;
  reason?: string;
}

/**
 * 팀의 회사 좌표를 기준으로 주변 식당을 카카오에서 가져와 Restaurant 테이블에 upsert 한다.
 *
 * 멱등성:
 *   `(source, externalId)` 복합 unique 키로 upsert 하므로, 같은 좌표/반경에 대해 여러 번
 *   호출해도 새 row가 누적되지 않는다. 이름·주소·좌표가 바뀐 경우 갱신만 일어난다.
 *
 * 데이터 한계:
 *   카카오 Local은 가격대/평점/태그/알러지 정보를 제공하지 않는다.
 *   - priceTier: 기본 'mid'
 *   - rating: null
 *   - excludedAllergens / dietarySupported: 빈 배열
 *   더 풍부한 메타는 추후 사람이 보강하거나 다른 소스(예: Google Places)를 덧붙여 채운다.
 */
@Injectable()
export class RestaurantSyncService {
  private readonly logger = new Logger(RestaurantSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly kakao: KakaoLocalAdapter,
  ) {}

  /**
   * 팀의 lat/lng를 기준으로 한 번 동기화한다.
   * - 좌표가 없으면 동기화 자체를 건너뛴다(상위에서 geocoding 후 호출되어야 함).
   * - 카카오 키가 없으면 enabled=false 결과를 반환한다.
   */
  async syncForTeam(teamId: string): Promise<SyncResult> {
    if (!this.kakao.isEnabled()) {
      return {
        enabled: false,
        fetched: 0,
        upserted: 0,
        skipped: 0,
        reason: 'KAKAO_REST_API_KEY가 설정되어 있지 않아 카카오 동기화를 건너뛰었어.',
      };
    }

    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) {
      return {
        enabled: true,
        fetched: 0,
        upserted: 0,
        skipped: 0,
        reason: '팀을 찾을 수 없어 동기화를 건너뛰었어.',
      };
    }
    if (team.lat === null || team.lng === null) {
      return {
        enabled: true,
        fetched: 0,
        upserted: 0,
        skipped: 0,
        reason: '팀 좌표가 비어 있어. 도로명 주소 입력 후 geocoding을 먼저 돌려야 해.',
      };
    }

    const places = await this.kakao.findNearbyRestaurants({
      lat: team.lat,
      lng: team.lng,
      radiusMeters: team.searchRadiusMeters,
    });

    let upserted = 0;
    let skipped = 0;

    const now = new Date();
    for (const place of places) {
      const lat = Number(place.y);
      const lng = Number(place.x);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        skipped += 1;
        continue;
      }
      const category = mapCategory(place.category_name);
      try {
        await this.prisma.restaurant.upsert({
          where: {
            source_externalId: { source: 'kakao', externalId: place.id },
          },
          update: {
            name: place.place_name,
            category,
            lat,
            lng,
            address: place.road_address_name || place.address_name,
            lastVerifiedAt: now,
          },
          create: {
            source: 'kakao',
            externalId: place.id,
            name: place.place_name,
            category,
            priceTier: 'mid',
            lat,
            lng,
            address: place.road_address_name || place.address_name,
            lastVerifiedAt: now,
          },
        });
        upserted += 1;
      } catch (err) {
        this.logger.warn(
          `[restaurant-sync] upsert failed name=${place.place_name} err=${(err as Error).message}`,
        );
        skipped += 1;
      }
    }

    this.logger.log(
      `[restaurant-sync] team=${team.id} fetched=${places.length} upserted=${upserted} skipped=${skipped}`,
    );

    return {
      enabled: true,
      fetched: places.length,
      upserted,
      skipped,
    };
  }
}

/**
 * 카카오의 자유 텍스트 카테고리 경로(예: "음식점 > 한식 > 국밥")를 우리 RestaurantCategory enum으로
 * 매핑한다. 매칭 우선순위는 가장 구체적인 토큰 → 일반 토큰 순.
 *
 * dessert 분기를 가장 먼저 두는 이유:
 *  - 카카오는 "음식점 > 한식 > 떡,한과" 처럼 dessert/한과 종류도 상위 카테고리에 '한식' 토큰을
 *    포함시켜 내려준다. 만약 korean 분기를 먼저 두면 떡·한과가 한식으로 잡혀 점심 후보에 섞인다.
 *  - 동일하게 "디저트 카페", "베이커리 카페" 같은 표기는 cafe 분기에 흡수돼 일반 카페와 구분이
 *    안 되는 문제가 있었다.
 *  → dessert 키워드를 다른 어떤 분기보다 먼저 잡아서 명확하게 분리한다.
 *
 * 매칭 안 되면 'etc'.
 */
export function mapCategory(categoryName: string): RestaurantCategory {
  const lower = categoryName.toLowerCase();
  const has = (token: string) => lower.includes(token);

  // dessert: 식사가 아닌 메뉴 전문점. 점심 추천 hard filter 에서 제외된다.
  if (
    has('떡,한과') ||
    has('한과') ||
    has('디저트') ||
    has('베이커리') ||
    has('케이크') ||
    has('도넛') ||
    has('도너츠') ||
    has('아이스크림') ||
    has('젤라또') ||
    has('마카롱') ||
    has('타르트') ||
    has('쿠키') ||
    has('초콜릿') ||
    has('전통차') ||
    has('베이글') ||
    has('크로플') ||
    has('크레페') ||
    has('스무디')
  ) {
    return 'dessert';
  }
  if (
    has('일식') ||
    has('스시') ||
    has('초밥') ||
    has('라멘') ||
    has('우동') ||
    has('돈카츠') ||
    has('규동')
  ) {
    return 'japanese';
  }
  if (has('중식') || has('중국') || has('짜장') || has('짬뽕') || has('마라') || has('딤섬')) {
    return 'chinese';
  }
  if (
    has('양식') ||
    has('스테이크') ||
    has('파스타') ||
    has('피자') ||
    has('이탈리') ||
    has('프렌치') ||
    has('버거') ||
    has('샌드위치')
  ) {
    return 'western';
  }
  if (
    has('아시안') ||
    has('베트남') ||
    has('태국') ||
    has('인도') ||
    has('터키') ||
    has('할랄') ||
    has('동남아')
  ) {
    return 'asian';
  }
  if (has('분식') || has('떡볶이') || has('김밥') || has('도시락')) {
    return 'snack';
  }
  // 카페: 점심 식사가 가능한 브런치 카페·샐러드 전문점도 여기로 묶는다.
  // (베이커리/디저트류는 위 dessert 분기에서 이미 걸러진 뒤다.)
  if (has('카페') || has('브런치') || has('샐러드')) {
    return 'cafe';
  }
  if (
    has('한식') ||
    has('국밥') ||
    has('찌개') ||
    has('백반') ||
    has('곱창') ||
    has('순두부') ||
    has('냉면')
  ) {
    return 'korean';
  }
  return 'etc';
}
