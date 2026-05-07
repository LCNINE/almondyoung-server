import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260507000000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`ALTER TABLE "product_sort_index" ADD COLUMN IF NOT EXISTS "review_count" integer not null default 0;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_sort_review_count" ON "product_sort_index" ("review_count") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "idx_sort_review_count";`);
    this.addSql(`ALTER TABLE "product_sort_index" DROP COLUMN IF EXISTS "review_count";`);
  }

}
