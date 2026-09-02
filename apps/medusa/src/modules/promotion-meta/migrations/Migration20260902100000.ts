import { Migration } from '@medusajs/framework/mikro-orm/migrations';

/**
 * `coupon_grant` — 발급 인스턴스 테이블 (설계 §3.1).
 *
 * 기존 링크 행의 이관은 여기서 하지 않는다 — 링크 테이블의 실제 이름이 우리 소스에 없고
 * (부팅 시 `--execute-safe-links` 가 만든다) 추측한 이름으로 INSERT 를 쓰면 배포 중에 죽는다.
 * 이관은 `src/scripts/backfill-coupon-grants.ts` 가 링크 모듈 API 로 한다.
 */
export class Migration20260902100000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "coupon_grant" (
        "id" text NOT NULL,
        "promotion_id" text NOT NULL,
        "customer_id" text NOT NULL,
        "issue_key" text NOT NULL,
        "issued_via" text NOT NULL,
        "issued_at" timestamptz NOT NULL DEFAULT now(),
        "expires_at" timestamptz NULL,
        "used_at" timestamptz NULL,
        "order_id" text NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz NULL,
        CONSTRAINT "coupon_grant_pkey" PRIMARY KEY ("id")
      );
    `);
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "idx_coupon_grant_customer" ON "coupon_grant" ("customer_id") WHERE "deleted_at" IS NULL;`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "idx_coupon_grant_promotion" ON "coupon_grant" ("promotion_id") WHERE "deleted_at" IS NULL;`,
    );
    // 🔴 파셜이어야 한다 — 회수(soft delete) 후 재발급이 이 조건에 의존한다.
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_coupon_grant_issue_key" ` +
        `ON "coupon_grant" ("promotion_id", "customer_id", "issue_key") WHERE "deleted_at" IS NULL;`,
    );
    // 발급 경로 어휘를 DB 로도 닫는다 (promotion_meta 의 CHECK 제약과 같은 규약).
    this.addSql(
      `ALTER TABLE "coupon_grant" ADD CONSTRAINT "coupon_grant_issued_via_check" ` +
        `CHECK ("issued_via" IN ('customer_registered', 'membership_activated', ` +
        `'admin_manual', 'admin_force', 'customer_claim'));`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "coupon_grant";`);
  }
}
