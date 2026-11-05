import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261104065338 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "quantity_discount_list" drop constraint if exists "quantity_discount_list_audience_min_quantity_period_key_unique";`);
    this.addSql(`create table if not exists "quantity_discount_list" ("id" text not null, "audience" text check ("audience" in ('general', 'membership')) not null, "min_quantity" integer not null, "period_key" text not null, "starts_at" timestamptz null, "ends_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "quantity_discount_list_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_quantity_discount_list_deleted_at" ON "quantity_discount_list" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_quantity_discount_list_audience_min_quantity_period_key_unique" ON "quantity_discount_list" ("audience", "min_quantity", "period_key") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "quantity_discount_list" cascade;`);
  }

}
