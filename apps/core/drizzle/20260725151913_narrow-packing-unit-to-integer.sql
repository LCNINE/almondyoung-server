-- packing_unit 은 "몇 개입"이라는 숫자인데 컬럼이 varchar(64) 였다.
-- 값이 실무에서 쓰인 적이 없어 전량 폐기하고 타입을 좁힌다.
-- ADR-0005 §5 의 3-PR expand-contract 를 생략한 근거:
-- 버릴 데이터라 손실이 없고, ALTER 직후 컬럼이 전량 NULL 이라
-- 롤링 배포 중 구/신 코드가 무엇을 읽든 null 이다.
-- 배포 순서는 migrate → deploy (expand 순서).
-- Postgres 는 varchar→integer 에 등록된 묵시적/대입 캐스트가 없어
-- 테이블이 텅 비어(전량 NULL) 있어도 USING 절 없이는 ALTER 가 거부된다
-- ("column ... cannot be cast automatically to type integer").
-- 위 UPDATE 로 전량 NULL 을 만들어 둔 뒤라 USING 캐스트는 안전하다.
UPDATE "sku_barcodes" SET "packing_unit" = NULL WHERE "packing_unit" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "sku_barcodes" ALTER COLUMN "packing_unit" SET DATA TYPE integer USING "packing_unit"::integer;--> statement-breakpoint
ALTER TABLE "sku_barcodes" ADD CONSTRAINT "ck_sku_barcodes_packing_unit_positive" CHECK ("sku_barcodes"."packing_unit" IS NULL OR "sku_barcodes"."packing_unit" >= 1);