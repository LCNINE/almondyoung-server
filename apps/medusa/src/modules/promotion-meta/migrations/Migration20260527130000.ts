import { Migration } from '@medusajs/framework/mikro-orm/migrations';

export class Migration20260527130000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`ALTER TABLE "promotion_meta" ADD COLUMN IF NOT EXISTS "issued_count" integer NOT NULL DEFAULT 0;`);
  }

  override async down(): Promise<void> {
    this.addSql(`ALTER TABLE "promotion_meta" DROP COLUMN IF EXISTS "issued_count";`);
  }
}
