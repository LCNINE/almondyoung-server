import { Migration } from '@medusajs/framework/mikro-orm/migrations';

export class Migration20260526140000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `ALTER TABLE "promotion_meta" ADD CONSTRAINT "promotion_meta_visibility_check" CHECK (visibility IS NULL OR visibility IN ('public', 'claimable', 'assigned_only'));`
    );
  }

  override async down(): Promise<void> {
    this.addSql(`ALTER TABLE "promotion_meta" DROP CONSTRAINT IF EXISTS "promotion_meta_visibility_check";`);
  }
}
