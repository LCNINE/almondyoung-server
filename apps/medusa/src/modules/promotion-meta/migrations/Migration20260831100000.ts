import { Migration } from '@medusajs/framework/mikro-orm/migrations';

/**
 * 유효기간 두 축 (#488 결정 1).
 *
 * `starts_at`/`ends_at` 은 오늘 `promotion_campaign.starts_at`/`ends_at` 의 **1:1 이사**다.
 * 그래서 기존 값을 백필한다 — 안 하면 이미 만든 쿠폰의 기간이 화면에서 사라진다.
 *
 * ⚠️ 백필은 코어 소유 테이블(`promotion`·`promotion_campaign`)에서 **읽기만** 한다.
 * 캠페인을 비우고 떼는 쓰기는 `src/scripts/detach-coupon-campaigns.ts` 가 배포 후에 한다 —
 * 남의 모듈 테이블을 우리 모듈 마이그레이션이 UPDATE 하면 모듈 격리를 어기고 down() 이 복원 불가다.
 */
export class Migration20260831100000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`ALTER TABLE "promotion_meta" ADD COLUMN IF NOT EXISTS "starts_at" timestamptz NULL;`);
    this.addSql(`ALTER TABLE "promotion_meta" ADD COLUMN IF NOT EXISTS "ends_at" timestamptz NULL;`);
    this.addSql(`ALTER TABLE "promotion_meta" ADD COLUMN IF NOT EXISTS "validity_days" integer NULL;`);

    this.addSql(
      `ALTER TABLE "promotion_meta" ADD CONSTRAINT "promotion_meta_validity_days_check" ` +
        `CHECK ("validity_days" IS NULL OR "validity_days" > 0);`,
    );

    // 가드: 커스텀 모듈 마이그레이션 간 실행 순서가 보장되지 않아, 새 DB에서는 이 마이그레이션이
    // 코어 promotion/promotion_campaign 테이블보다 먼저 돌 수 있다 — 데이터가 아니라 순서 문제다.
    this.addSql(`
DO $$
BEGIN
  IF to_regclass('public.promotion') IS NOT NULL
     AND to_regclass('public.promotion_campaign') IS NOT NULL THEN
    UPDATE "promotion_meta" m
       SET "starts_at" = c."starts_at", "ends_at" = c."ends_at"
      FROM "promotion" p
      JOIN "promotion_campaign" c ON c."id" = p."campaign_id"
     WHERE p."id" = m."promotion_id"
       AND m."deleted_at" IS NULL AND p."deleted_at" IS NULL AND c."deleted_at" IS NULL;
  END IF;
END $$;
`);
  }

  override async down(): Promise<void> {
    this.addSql(`ALTER TABLE "promotion_meta" DROP CONSTRAINT IF EXISTS "promotion_meta_validity_days_check";`);
    this.addSql(`ALTER TABLE "promotion_meta" DROP COLUMN IF EXISTS "validity_days";`);
    this.addSql(`ALTER TABLE "promotion_meta" DROP COLUMN IF EXISTS "ends_at";`);
    this.addSql(`ALTER TABLE "promotion_meta" DROP COLUMN IF EXISTS "starts_at";`);
  }
}
