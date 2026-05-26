import { Migration } from '@medusajs/framework/mikro-orm/migrations';

export class Migration20260526160000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `ALTER TABLE "promotion_meta" ADD COLUMN IF NOT EXISTS "max_claims" integer NULL;`
    );
  }

  override async down(): Promise<void> {
    this.addSql(`ALTER TABLE "promotion_meta" DROP COLUMN IF EXISTS "max_claims";`);
  }
}
