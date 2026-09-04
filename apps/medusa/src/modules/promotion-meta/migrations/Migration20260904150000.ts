import { Migration } from '@medusajs/framework/mikro-orm/migrations';

/**
 * contract 단계 — 죽은 컬럼 둘을 지운다 (ADR-0034 결정 6, expand-contract).
 *
 * `coupon_grant.order_id` — 소모의 키가 카트로 옮겨가며(2026-09-04 개정) 읽기·쓰기가 모두 끊겼다.
 * `promotion_meta.issued_count` — 상한의 정본이 `coupon_grant` COUNT 가 되며 표시도 COUNT 에서 온다.
 *
 * **선행 조건 3개를 라이브에서 실측하고 나서 지운다** (2026-09-04, PR-3 배포 직후):
 *   (ⅰ) 배포 시각 이후 `order_id` 가 쓰인 행 0 · (ⅱ) 그 컬럼을 읽는 프로덕션 코드 0 ·
 *   (ⅲ) 롤링 창 사각지대 집합(`used_at NOT NULL AND cart_id IS NULL AND order_id NOT NULL`) 0행.
 *
 * `issued_count` 는 컬럼과 미러 쓰기(`mirrorIssuedCount`)를 **같은 PR 에서** 지운다. 롤링 중 옛
 * 태스크의 미러 UPDATE 가 없는 컬럼을 만나 발급 트랜잭션이 던질 수 있는데, 그건 fail-closed 고
 * (과다 발급이 아니라 발급 실패) 라이브 발급량이 사실상 0이라 감수한다. 쪼개면 그 사이 롤백이
 * 났을 때 옛 코드가 «동결된» 카운터로 상한을 집행해 fail-open 이 된다(#778 리뷰 F5) — 그쪽이 나쁘다.
 *
 * 🔴 `down()` 은 스키마만 되돌린다. 지워진 값은 복구되지 않는다 — `order_id` 는 `order_cart`
 *    링크로 다시 구할 수 있지만 `issued_count` 는 `coupon_grant` COUNT 로 다시 세야 한다.
 */
export class Migration20260904150000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "idx_coupon_grant_order";`);
    this.addSql(`ALTER TABLE "coupon_grant" DROP COLUMN IF EXISTS "order_id";`);
    this.addSql(`ALTER TABLE "promotion_meta" DROP COLUMN IF EXISTS "issued_count";`);
  }

  override async down(): Promise<void> {
    this.addSql(`ALTER TABLE "promotion_meta" ADD COLUMN IF NOT EXISTS "issued_count" integer NOT NULL DEFAULT 0;`);
    this.addSql(`ALTER TABLE "coupon_grant" ADD COLUMN IF NOT EXISTS "order_id" text NULL;`);
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "idx_coupon_grant_order" ON "coupon_grant" ("order_id") WHERE "deleted_at" IS NULL;`,
    );
  }
}
