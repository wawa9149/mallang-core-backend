/**
 * 두 좌표 사이의 Haversine 직선 거리(미터).
 * 점심 추천/투표 표시 범위(수 km)에서는 충분히 정확하다.
 * 외부 지오 라이브러리 없이 직접 구현하여 추천 서비스와 투표 서비스가 공유한다.
 */
export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
