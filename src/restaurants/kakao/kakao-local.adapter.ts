import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  KakaoAddressSearchResponse,
  KakaoCategorySearchResponse,
  KakaoPlaceDocument,
} from './kakao-api.types';

/**
 * 카카오 디벨로퍼스 Local API의 얇은 HTTP 어댑터.
 *
 * - 인증: REST API 키를 `Authorization: KakaoAK ${key}` 헤더로 전달.
 * - 키가 환경에 없으면 `isEnabled()`가 false를 돌려주고, 호출 메서드는 명시적 예외를 던진다.
 *   상위 서비스(RestaurantSyncService 등)는 이 플래그를 먼저 확인해 fallback 흐름을 탄다.
 *
 * 응답 파싱은 외부 라이브러리를 들이지 않기 위해 Node 18+의 global `fetch`로 처리한다.
 * 응답 타입은 `kakao-api.types.ts` 참고.
 */
@Injectable()
export class KakaoLocalAdapter {
  private readonly logger = new Logger(KakaoLocalAdapter.name);
  private readonly apiKey: string | null;

  constructor(config: ConfigService) {
    const raw = config.get<string>('KAKAO_REST_API_KEY');
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    this.apiKey = trimmed.length > 0 ? trimmed : null;
  }

  isEnabled(): boolean {
    return this.apiKey !== null;
  }

  /**
   * 도로명/지번 주소 한 줄 → 좌표(lat/lng) 1건.
   * 결과가 0건이면 null을 반환한다(잘못된 주소로 인한 NotFound는 호출 측이 정책 결정).
   */
  async geocode(address: string): Promise<{ lat: number; lng: number; matched: string } | null> {
    this.ensureKey();
    const query = address.trim();
    if (query.length === 0) return null;

    const url = new URL('https://dapi.kakao.com/v2/local/search/address.json');
    url.searchParams.set('query', query);

    const json = await this.request<KakaoAddressSearchResponse>(url, 'geocode');
    const top = json.documents[0];
    if (!top) return null;
    const lng = Number(top.x);
    const lat = Number(top.y);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng, matched: top.address_name };
  }

  /**
   * 좌표 기준 반경(미터) 내 음식점(category_group_code=FD6) 전부 가져오기.
   * 카카오는 한 페이지 최대 15건, 최대 3페이지(=45건)를 지원한다. 페이지를 순회해 모두 합쳐 반환.
   */
  async findNearbyRestaurants(args: {
    lat: number;
    lng: number;
    radiusMeters: number;
  }): Promise<KakaoPlaceDocument[]> {
    this.ensureKey();
    const { lat, lng, radiusMeters } = args;
    const radius = Math.max(1, Math.min(20_000, Math.floor(radiusMeters)));
    const results: KakaoPlaceDocument[] = [];

    for (let page = 1; page <= 3; page += 1) {
      const url = new URL('https://dapi.kakao.com/v2/local/search/category.json');
      url.searchParams.set('category_group_code', 'FD6');
      url.searchParams.set('x', String(lng));
      url.searchParams.set('y', String(lat));
      url.searchParams.set('radius', String(radius));
      url.searchParams.set('page', String(page));
      url.searchParams.set('size', '15');
      url.searchParams.set('sort', 'distance');

      const json = await this.request<KakaoCategorySearchResponse>(url, 'category-search');
      results.push(...json.documents);
      if (json.meta.is_end) break;
    }
    return results;
  }

  private ensureKey(): void {
    if (!this.apiKey) {
      throw new ServiceUnavailableException(
        '카카오 REST API 키가 설정돼 있지 않아. 백엔드 .env의 KAKAO_REST_API_KEY를 채워줘.',
      );
    }
  }

  private async request<T>(url: URL, label: string): Promise<T> {
    const res = await fetch(url, {
      headers: {
        Authorization: `KakaoAK ${this.apiKey}`,
      },
    });
    if (!res.ok) {
      const body = await safeReadText(res);
      this.logger.warn(
        `[kakao:${label}] status=${res.status} url=${url.pathname} body=${body.slice(0, 200)}`,
      );
      throw new ServiceUnavailableException(`카카오 Local API 호출 실패 (${res.status}).`);
    }
    return (await res.json()) as T;
  }
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
