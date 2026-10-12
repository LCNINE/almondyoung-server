import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261009120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "time_sale" ("id" text not null, "title" text not null, "starts_at" timestamptz not null, "ends_at" timestamptz not null, "status" text check ("status" in ('draft', 'active')) not null default 'draft', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "time_sale_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_time_sale_deleted_at" ON "time_sale" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "time_sale" cascade;`);
  }

}
