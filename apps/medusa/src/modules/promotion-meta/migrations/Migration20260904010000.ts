import { Migration } from '@medusajs/framework/mikro-orm/migrations';

/**
 * `coupon_grant.revoked_at` — 회수 표지 (설계 결정 3).
 *
 * `deleted_at` 이 「슬롯을 안 점유한다」와 「회수됐다」를 겸하고 있어서, 회수 후에도 남는
 * **사용된** 장을 `restoreGrantsByOrder` 가 되살렸다. 회수 사실을 별도 열로 적는다.
 *
 * `deleted_at` 의 의미와 partial unique 인덱스는 **건드리지 않는다** — 회수 후 재발급이
 * `WHERE deleted_at IS NULL` 조건에 의존한다.
 */
export class Migration20260904010000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`ALTER TABLE "coupon_grant" ADD COLUMN IF NOT EXISTS "revoked_at" timestamptz NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`ALTER TABLE "coupon_grant" DROP COLUMN IF EXISTS "revoked_at";`);
  }
}
