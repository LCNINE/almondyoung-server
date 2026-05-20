-- 1) deletedAt 컬럼 추가 (백필 대상)
ALTER TABLE "questions" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
-- 2) status 컬럼을 text 로 분리 (enum 재정의 준비)
ALTER TABLE "questions" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "questions" ALTER COLUMN "status" SET DEFAULT 'active'::text;--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "status" SET DEFAULT 'active'::text;--> statement-breakpoint
-- 3) 기존 status='deleted' 데이터를 deletedAt 으로 백필 후 status 정리 (enum 에서 'deleted' 제거 가능하도록)
UPDATE "questions" SET "deleted_at" = "updated_at" WHERE "status" = 'deleted';--> statement-breakpoint
UPDATE "questions" SET "status" = 'active' WHERE "status" = 'deleted';--> statement-breakpoint
UPDATE "reviews" SET "deleted_at" = "updated_at" WHERE "status" = 'deleted';--> statement-breakpoint
UPDATE "reviews" SET "status" = 'active' WHERE "status" = 'deleted';--> statement-breakpoint
-- 4) enum 재정의 ('deleted' 제거)
DROP TYPE "public"."question_status";--> statement-breakpoint
CREATE TYPE "public"."question_status" AS ENUM('active', 'answered');--> statement-breakpoint
ALTER TABLE "questions" ALTER COLUMN "status" SET DEFAULT 'active'::"public"."question_status";--> statement-breakpoint
ALTER TABLE "questions" ALTER COLUMN "status" SET DATA TYPE "public"."question_status" USING "status"::"public"."question_status";--> statement-breakpoint
DROP TYPE "public"."review_status";--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('active', 'hidden');--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "status" SET DEFAULT 'active'::"public"."review_status";--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "status" SET DATA TYPE "public"."review_status" USING "status"::"public"."review_status";
