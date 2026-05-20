-- RestaurantCategory enum 에 'dessert' 값을 추가한다.
-- PostgreSQL 의 ALTER TYPE ADD VALUE 는 자체적으로 트랜잭션 외부에서 commit 되어야 하며,
-- 같은 마이그레이션 안에서 새 값을 곧바로 사용할 수 없다(PG enum 제약).
-- 그래서 데이터 reclassification UPDATE 는 별도 마이그레이션 파일로 분리한다.
ALTER TYPE "RestaurantCategory" ADD VALUE 'dessert';
