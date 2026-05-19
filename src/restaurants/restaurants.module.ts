import { Module } from '@nestjs/common';
import { KakaoLocalAdapter } from './kakao/kakao-local.adapter';
import { RestaurantSyncService } from './restaurant-sync.service';

/**
 * 식당 데이터 동기화 관련 모듈.
 * 외부 어댑터(현재 카카오 Local)와 그 결과를 DB에 반영하는 서비스를 묶어둔다.
 * TeamsModule이 주소 변경 시 이 서비스를 호출하고, LunchVotesModule은
 * 동기화된 데이터를 그대로 추천 후보로 읽어간다(직접 의존 X).
 */
@Module({
  providers: [KakaoLocalAdapter, RestaurantSyncService],
  exports: [KakaoLocalAdapter, RestaurantSyncService],
})
export class RestaurantsModule {}
