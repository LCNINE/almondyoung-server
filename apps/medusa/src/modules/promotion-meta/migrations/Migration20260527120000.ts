import { Migration } from '@medusajs/framework/mikro-orm/migrations';

export class Migration20260527120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`ALTER TABLE "promotion_meta" DROP COLUMN IF EXISTS "max_uses_per_customer";`);
  }

  override async down(): Promise<void> {
    this.addSql(`ALTER TABLE "promotion_meta" ADD COLUMN IF NOT EXISTS "max_uses_per_customer" numeric NULL;`);
  }
}
