import { Migration } from '@medusajs/framework/mikro-orm/migrations';

export class Migration20260721120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table if not exists "coupon_event" (` +
      `"id" text not null, ` +
      `"slug" text not null, ` +
      `"title" text not null, ` +
      `"description" text null, ` +
      `"banner_image_url" text null, ` +
      `"starts_at" timestamptz null, ` +
      `"ends_at" timestamptz null, ` +
      `"status" text not null default 'draft', ` +
      `"created_at" timestamptz not null default now(), ` +
      `"updated_at" timestamptz not null default now(), ` +
      `"deleted_at" timestamptz null, ` +
      `constraint "coupon_event_pkey" primary key ("id")` +
      `);`
    );
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_coupon_event_slug" ON "coupon_event" ("slug") WHERE deleted_at IS NULL;`
    );

    this.addSql(
      `create table if not exists "coupon_event_item" (` +
      `"id" text not null, ` +
      `"event_id" text not null, ` +
      `"promotion_id" text not null, ` +
      `"sort_order" integer not null default 0, ` +
      `"created_at" timestamptz not null default now(), ` +
      `"updated_at" timestamptz not null default now(), ` +
      `"deleted_at" timestamptz null, ` +
      `constraint "coupon_event_item_pkey" primary key ("id")` +
      `);`
    );
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_coupon_event_item_unique" ON "coupon_event_item" ("event_id", "promotion_id") WHERE deleted_at IS NULL;`
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "idx_coupon_event_item_event_id" ON "coupon_event_item" ("event_id") WHERE deleted_at IS NULL;`
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "coupon_event_item" cascade;`);
    this.addSql(`drop table if exists "coupon_event" cascade;`);
  }
}
