import { Migration } from '@medusajs/framework/mikro-orm/migrations';

export class Migration20260527100000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `ALTER TABLE "promotion_meta" ADD COLUMN IF NOT EXISTS "auto_issue_trigger" text NULL;`
    );
    this.addSql(
      `ALTER TABLE "promotion_meta" ADD CONSTRAINT "promotion_meta_auto_issue_trigger_check" ` +
      `CHECK (auto_issue_trigger IS NULL OR auto_issue_trigger IN ('customer_registered', 'membership_activated', 'birthday'));`
    );
  }

  override async down(): Promise<void> {
    this.addSql(`ALTER TABLE "promotion_meta" DROP CONSTRAINT IF EXISTS "promotion_meta_auto_issue_trigger_check";`);
    this.addSql(`ALTER TABLE "promotion_meta" DROP COLUMN IF EXISTS "auto_issue_trigger";`);
  }
}
