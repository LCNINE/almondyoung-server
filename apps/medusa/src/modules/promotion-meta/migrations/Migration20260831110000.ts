import { Migration } from '@medusajs/framework/mikro-orm/migrations';

/**
 * `birthday` 트리거 폐지 (#488 마스터플랜 결정 2).
 *
 * 라이브 실측 0건이나(2026-08-31), dev/로컬 DB 에 남아 있으면 CHECK 추가가 실패하므로
 * 방어적으로 먼저 비운다. 생일 발급은 구현하지 않기로 했고 UI 에서도 disabled 였다.
 */
export class Migration20260831110000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`UPDATE "promotion_meta" SET "auto_issue_trigger" = NULL WHERE "auto_issue_trigger" = 'birthday';`);
    this.addSql(`ALTER TABLE "promotion_meta" DROP CONSTRAINT IF EXISTS "promotion_meta_auto_issue_trigger_check";`);
    this.addSql(
      `ALTER TABLE "promotion_meta" ADD CONSTRAINT "promotion_meta_auto_issue_trigger_check" ` +
        `CHECK ("auto_issue_trigger" IS NULL OR "auto_issue_trigger" IN ('customer_registered', 'membership_activated'));`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`ALTER TABLE "promotion_meta" DROP CONSTRAINT IF EXISTS "promotion_meta_auto_issue_trigger_check";`);
    this.addSql(
      `ALTER TABLE "promotion_meta" ADD CONSTRAINT "promotion_meta_auto_issue_trigger_check" ` +
        `CHECK ("auto_issue_trigger" IS NULL OR "auto_issue_trigger" IN ('customer_registered', 'membership_activated', 'birthday'));`,
    );
  }
}
