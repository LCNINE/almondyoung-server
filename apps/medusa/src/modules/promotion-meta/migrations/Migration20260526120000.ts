import { Migration } from '@medusajs/framework/mikro-orm/migrations';

export class Migration20260526120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `ALTER TABLE "promotion_meta" ADD COLUMN IF NOT EXISTS "visibility" text NOT NULL DEFAULT 'public';`
    );
  }

  override async down(): Promise<void> {
    this.addSql(`ALTER TABLE "promotion_meta" DROP COLUMN IF EXISTS "visibility";`);
  }
}
