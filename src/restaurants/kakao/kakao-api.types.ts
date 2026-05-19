/**
 * 카카오 디벨로퍼스 Local API 응답 구조 일부.
 * 우리가 실제로 사용하는 필드만 좁게 선언해 둔다(필드 추가는 자유).
 *
 * 좌표는 카카오 응답에서 문자열로 내려온다("126.97...", "37.56..."). 어댑터 안에서 파싱한다.
 */

export interface KakaoAddressDocument {
  /** 도로명 주소 또는 지번 주소 (raw 그대로 보존). */
  address_name: string;
  /** WGS84 경도(문자열). */
  x: string;
  /** WGS84 위도(문자열). */
  y: string;
}

export interface KakaoAddressSearchResponse {
  documents: KakaoAddressDocument[];
}

/**
 * 카카오 음식점(category_group_code = FD6) 검색 결과 항목.
 * 가격대/평점/태그는 카카오 응답에 없어 모두 기본값으로 채운다.
 */
export interface KakaoPlaceDocument {
  /** 카카오 내부 식별자. 우리 Restaurant.externalId 로 사용. */
  id: string;
  place_name: string;
  /**
   * 세부 카테고리 경로(예: "음식점 > 한식 > 국밥").
   * 우리 RestaurantCategory enum으로 휴리스틱 매핑할 때 사용.
   */
  category_name: string;
  /** 항상 "FD6". */
  category_group_code: 'FD6';
  road_address_name: string;
  address_name: string;
  /** WGS84 경도(문자열). */
  x: string;
  /** WGS84 위도(문자열). */
  y: string;
  /** 호출 중심점으로부터의 거리(미터). 좌표 hard-filter와 reason 표시에 사용. */
  distance: string;
}

export interface KakaoCategorySearchMeta {
  total_count: number;
  pageable_count: number;
  is_end: boolean;
}

export interface KakaoCategorySearchResponse {
  meta: KakaoCategorySearchMeta;
  documents: KakaoPlaceDocument[];
}
