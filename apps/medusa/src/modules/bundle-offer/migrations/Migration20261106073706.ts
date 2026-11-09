import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261106073706 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "bundle_offer_revision" drop constraint if exists "bundle_offer_revision_product_id_unique";`);
    this.addSql(`alter table if exists "bundle_offer" drop constraint if exists "bundle_offer_product_id_addon_product_id_unique";`);
    this.addSql(`create table if not exists "bundle_offer" ("id" text not null, "product_id" text not null, "addon_product_id" text not null, "addon_pim_master_id" text not null, "allowed_variant_ids" text[] null, "regular_rate_bp" integer not null, "membership_rate_bp" integer not null, "enabled" boolean not null default true, "starts_at" timestamptz null, "ends_at" timestamptz null, "label" text null, "sort" integer not null default 0, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "bundle_offer_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_bundle_offer_deleted_at" ON "bundle_offer" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_bundle_offer_product_id_addon_product_id_unique" ON "bundle_offer" ("product_id", "addon_product_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_bundle_offer_addon_product_id" ON "bundle_offer" ("addon_product_id") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "bundle_offer_revision" ("id" text not null, "product_id" text not null, "changed_at" timestamptz not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "bundle_offer_revision_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_bundle_offer_revision_deleted_at" ON "bundle_offer_revision" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_bundle_offer_revision_product_id_unique" ON "bundle_offer_revision" ("product_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "bundle_offer" cascade;`);

    this.addSql(`drop table if exists "bundle_offer_revision" cascade;`);
  }

}
