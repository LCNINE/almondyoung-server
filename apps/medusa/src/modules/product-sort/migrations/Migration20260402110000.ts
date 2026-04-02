import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260402110000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_sort_key_price_sort_key" ON "product_sort_key" ("price_sort_key") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_sort_key_sales_sort_key" ON "product_sort_key" ("sales_sort_key" DESC) WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "IDX_product_sort_key_price_sort_key";`);
    this.addSql(`DROP INDEX IF EXISTS "IDX_product_sort_key_sales_sort_key";`);
  }

}
