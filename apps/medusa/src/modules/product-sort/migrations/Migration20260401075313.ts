import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260401075313 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "product_sort_key" drop constraint if exists "product_sort_key_product_id_unique";`);
    this.addSql(`create table if not exists "product_sort_key" ("id" text not null, "product_id" text not null, "price_sort_key" numeric null, "sales_sort_key" integer not null default 0, "last_synced_at" timestamptz null, "raw_price_sort_key" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "product_sort_key_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_product_sort_key_product_id_unique" ON "product_sort_key" ("product_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_sort_key_deleted_at" ON "product_sort_key" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "product_sort_key" cascade;`);
  }

}
