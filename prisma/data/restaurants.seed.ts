import type { Prisma } from '@prisma/client';

/**
 * 시드용 식당 데이터 (강남역 주변을 가정한 더미값).
 *
 * 좌표는 Phase 2(외부 geocoding) 전까지 null로 둔다.
 * 추천 시스템은 좌표가 없는 경우 거리 hard-filter를 건너뛰고
 * 카테고리/태그/평점/최근 방문 회피만으로 후보를 선별한다.
 *
 * 데이터 출처: 실제 식당이 아닌 카테고리/태그 다양성을 확보하기 위한 합성 시드.
 * 운영 데이터로는 외부 API 동기화 결과를 사용한다.
 */
export const SEED_RESTAURANTS: Prisma.RestaurantCreateInput[] = [
  // ─── 한식 ─────────────────────────────────────────────────────────
  {
    name: '강남 김밥천국',
    category: 'korean',
    priceTier: 'low',
    rating: 3.8,
    tags: ['혼밥', '빠름', '국물'],
    excludedAllergens: [],
    dietarySupported: [],
  },
  {
    name: '한솥 본점',
    category: 'korean',
    priceTier: 'low',
    rating: 3.9,
    tags: ['혼밥', '도시락', '빠름'],
  },
  {
    name: '본가 설렁탕',
    category: 'korean',
    priceTier: 'mid',
    rating: 4.3,
    tags: ['국물', '점심특선'],
    excludedAllergens: ['소고기'],
  },
  {
    name: '신촌 칼국수',
    category: 'korean',
    priceTier: 'mid',
    rating: 4.2,
    tags: ['국물', '면', '단체석'],
    hasRoom: true,
    capacity: 30,
  },
  {
    name: '엽기떡볶이',
    category: 'korean',
    priceTier: 'low',
    rating: 4.1,
    tags: ['매운맛', '분식'],
  },
  {
    name: '본죽',
    category: 'korean',
    priceTier: 'mid',
    rating: 4.0,
    tags: ['속편함', '죽'],
    dietarySupported: ['vegetarian'],
  },
  {
    name: '강남 순두부',
    category: 'korean',
    priceTier: 'mid',
    rating: 4.4,
    tags: ['국물', '매운맛'],
    dietarySupported: ['vegetarian'],
  },
  {
    name: '교대 곱창',
    category: 'korean',
    priceTier: 'high',
    rating: 4.5,
    tags: ['회식', '단체석'],
    hasRoom: true,
    capacity: 40,
    excludedAllergens: ['소고기', '내장'],
  },
  {
    name: '한촌설렁탕',
    category: 'korean',
    priceTier: 'mid',
    rating: 4.2,
    tags: ['국물'],
    excludedAllergens: ['소고기'],
  },
  {
    name: '명동 함흥냉면',
    category: 'korean',
    priceTier: 'mid',
    rating: 4.0,
    tags: ['면', '시원함'],
  },

  // ─── 일식 ─────────────────────────────────────────────────────────
  {
    name: '스시노 본점',
    category: 'japanese',
    priceTier: 'high',
    rating: 4.6,
    tags: ['생선', '점심특선'],
    excludedAllergens: ['생선', '갑각류'],
  },
  {
    name: '오마카세 하루',
    category: 'japanese',
    priceTier: 'high',
    rating: 4.7,
    tags: ['특별한날', '회식'],
    hasRoom: true,
    capacity: 12,
    excludedAllergens: ['생선'],
  },
  {
    name: '돈카츠 큐슈',
    category: 'japanese',
    priceTier: 'mid',
    rating: 4.3,
    tags: ['튀김'],
    excludedAllergens: ['돼지고기'],
  },
  {
    name: '우동집 사누키',
    category: 'japanese',
    priceTier: 'mid',
    rating: 4.1,
    tags: ['면', '국물'],
    dietarySupported: ['vegetarian'],
  },
  {
    name: '규동 마츠야',
    category: 'japanese',
    priceTier: 'low',
    rating: 4.0,
    tags: ['혼밥', '덮밥'],
    excludedAllergens: ['소고기'],
  },
  {
    name: '라멘 하카타',
    category: 'japanese',
    priceTier: 'mid',
    rating: 4.4,
    tags: ['면', '국물', '돼지'],
    excludedAllergens: ['돼지고기'],
  },

  // ─── 중식 ─────────────────────────────────────────────────────────
  {
    name: '홍콩반점',
    category: 'chinese',
    priceTier: 'low',
    rating: 4.0,
    tags: ['짜장', '단체석'],
    hasRoom: true,
    capacity: 50,
  },
  {
    name: '교동짬뽕',
    category: 'chinese',
    priceTier: 'mid',
    rating: 4.3,
    tags: ['짬뽕', '매운맛', '국물'],
    excludedAllergens: ['갑각류'],
  },
  {
    name: '딘타이펑',
    category: 'chinese',
    priceTier: 'high',
    rating: 4.5,
    tags: ['딤섬', '회식'],
    hasRoom: true,
    capacity: 60,
    dietarySupported: ['vegetarian'],
  },
  {
    name: '마라공방',
    category: 'chinese',
    priceTier: 'mid',
    rating: 4.2,
    tags: ['매운맛', '마라'],
  },

  // ─── 양식 ─────────────────────────────────────────────────────────
  {
    name: '파스타 부오노',
    category: 'western',
    priceTier: 'mid',
    rating: 4.4,
    tags: ['파스타', '데이트'],
    dietarySupported: ['vegetarian'],
  },
  {
    name: '쉐이크쉑',
    category: 'western',
    priceTier: 'mid',
    rating: 4.3,
    tags: ['버거', '혼밥'],
    excludedAllergens: ['소고기'],
  },
  {
    name: '아웃백',
    category: 'western',
    priceTier: 'high',
    rating: 4.2,
    tags: ['스테이크', '회식'],
    hasRoom: true,
    capacity: 80,
    excludedAllergens: ['소고기'],
  },
  {
    name: '서브웨이',
    category: 'western',
    priceTier: 'low',
    rating: 3.9,
    tags: ['혼밥', '샌드위치', '가벼움'],
    dietarySupported: ['vegetarian', 'vegan'],
  },
  {
    name: '도미노 피자',
    category: 'western',
    priceTier: 'mid',
    rating: 4.0,
    tags: ['피자', '단체석'],
    dietarySupported: ['vegetarian'],
  },

  // ─── 아시안 ────────────────────────────────────────────────────────
  {
    name: '미스사이공',
    category: 'asian',
    priceTier: 'mid',
    rating: 4.3,
    tags: ['쌀국수', '국물'],
    dietarySupported: ['vegetarian'],
  },
  {
    name: '타이오키친',
    category: 'asian',
    priceTier: 'mid',
    rating: 4.2,
    tags: ['매운맛', '팟타이'],
    dietarySupported: ['vegetarian'],
  },
  {
    name: '인디아 게이트',
    category: 'asian',
    priceTier: 'mid',
    rating: 4.4,
    tags: ['커리', '매운맛'],
    dietarySupported: ['vegetarian', 'vegan', 'halal'],
  },

  // ─── 분식/간편식 ─────────────────────────────────────────────────
  {
    name: '신전떡볶이',
    category: 'snack',
    priceTier: 'low',
    rating: 4.1,
    tags: ['매운맛', '혼밥', '빠름'],
  },
  {
    name: '서울김밥',
    category: 'snack',
    priceTier: 'low',
    rating: 3.7,
    tags: ['혼밥', '빠름'],
  },
  {
    name: '명동교자',
    category: 'snack',
    priceTier: 'mid',
    rating: 4.4,
    tags: ['칼국수', '만두', '국물'],
  },

  // ─── 카페/브런치 ─────────────────────────────────────────────────
  {
    name: '브런치하우스',
    category: 'cafe',
    priceTier: 'mid',
    rating: 4.2,
    tags: ['가벼움', '데이트'],
    dietarySupported: ['vegetarian'],
  },
  {
    name: '샐러디',
    category: 'cafe',
    priceTier: 'mid',
    rating: 4.1,
    tags: ['샐러드', '가벼움', '혼밥'],
    dietarySupported: ['vegetarian', 'vegan'],
  },

  // ─── 기타 ────────────────────────────────────────────────────────
  {
    name: '비건 키친',
    category: 'etc',
    priceTier: 'mid',
    rating: 4.5,
    tags: ['건강식', '가벼움'],
    dietarySupported: ['vegetarian', 'vegan'],
  },
  {
    name: '할랄 인디아',
    category: 'etc',
    priceTier: 'mid',
    rating: 4.3,
    tags: ['커리', '매운맛'],
    dietarySupported: ['halal', 'vegetarian'],
  },
];
