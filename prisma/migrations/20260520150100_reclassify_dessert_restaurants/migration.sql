-- 기존에 카카오에서 가져와 cafe/korean/etc 등으로 잘못 분류된 디저트·베이커리·한과류 식당을
-- 새로 도입된 RestaurantCategory.dessert 로 일괄 재분류한다.
--
-- 기준: 식당 이름(name) 에 식사가 아닌 메뉴 전문점임을 강하게 시사하는 키워드가 포함된 경우.
-- (카카오 원본 category_name 은 Restaurant 테이블에 저장하지 않으므로 이름 휴리스틱만 사용)
--
-- 휴리스틱이라 일부 false positive 가 있을 수 있다(예: "한과집 옆 분식" 같은 합성 이름).
-- 그래서 source = 'kakao' 로 받아온 row 만 대상으로 좁히고, 사람이 시드한 데이터는 건드리지 않는다.
UPDATE "restaurants"
SET category = 'dessert'
WHERE source = 'kakao'
  AND (
    name LIKE '%베이커리%' OR
    name LIKE '%디저트%' OR
    name LIKE '%케이크%' OR
    name LIKE '%도넛%' OR
    name LIKE '%도너츠%' OR
    name LIKE '%아이스크림%' OR
    name LIKE '%젤라또%' OR
    name LIKE '%마카롱%' OR
    name LIKE '%타르트%' OR
    name LIKE '%쿠키%' OR
    name LIKE '%초콜릿%' OR
    name LIKE '%한과%' OR
    name LIKE '%전통차%' OR
    name LIKE '%빵집%' OR
    name LIKE '%베이글%' OR
    name LIKE '%크로플%' OR
    name LIKE '%크레페%' OR
    name LIKE '%스무디%'
  );
