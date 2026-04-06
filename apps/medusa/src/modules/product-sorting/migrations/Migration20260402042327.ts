import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260402042327 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "product_sort_index" ("id" text not null, "product_id" text not null, "min_price" numeric not null default 0, "max_price" numeric not null default 0, "sales_count" integer not null default 0, "view_count" integer not null default 0, "currency_code" text not null default 'krw', "raw_min_price" jsonb not null default '{"value":"0","precision":20}', "raw_max_price" jsonb not null default '{"value":"0","precision":20}', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "product_sort_index_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_sort_index_deleted_at" ON "product_sort_index" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_sort_min_price" ON "product_sort_index" ("min_price") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_sort_sales_count" ON "product_sort_index" ("sales_count") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "idx_sort_product_currency" ON "product_sort_index" ("product_id", "currency_code") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "product_sort_index" cascade;`);
  }

}
