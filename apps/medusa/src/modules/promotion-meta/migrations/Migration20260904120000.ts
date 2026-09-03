import { Migration } from '@medusajs/framework/mikro-orm/migrations';

/**
 * `coupon_grant.cart_id` — 소모의 키를 주문에서 카트로 (ADR-0034 2026-09-04 개정, 결정 6).
 *
 * 소모가 `completeCartWorkflow` 의 `validate` 훅으로 옮겨가면 그 시점엔 주문 id 가 없다. 결정이
 * 내려지는 순간에 존재하는 것이 키다 — 카트. 취소 복원과 스위퍼가 이 컬럼으로 조회하므로
 * 인덱스를 같이 만든다(다른 인덱스와 같은 파셜 규약 — 모델의 DML 인덱스와 같은 인덱스다).
 *
 * `order_id` 는 여기서 건드리지 않는다 — expand 단계다. DROP 은 다음 배포 뒤 별도 PR.
 * Medusa 컨테이너는 부팅하며 스스로 migrate 하므로, 같은 PR 의 DROP 은 롤링 중 옛 태스크가 만난다.
 */
export class Migration20260904120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`ALTER TABLE "coupon_grant" ADD COLUMN IF NOT EXISTS "cart_id" text NULL;`);
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "idx_coupon_grant_cart" ON "coupon_grant" ("cart_id") WHERE "deleted_at" IS NULL;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "idx_coupon_grant_cart";`);
    this.addSql(`ALTER TABLE "coupon_grant" DROP COLUMN IF EXISTS "cart_id";`);
  }
}
