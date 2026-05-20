import { Migration } from '@medusajs/framework/mikro-orm/migrations';

export class Migration20260520164126 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table if not exists "promotion_meta" (` +
      `"id" text not null, ` +
      `"promotion_id" text not null, ` +
      `"name" text null, ` +
      `"max_discount_amount" numeric null, ` +
      `"max_uses_per_customer" numeric null, ` +
      `"created_by" text null, ` +
      `"created_at" timestamptz not null default now(), ` +
      `"updated_at" timestamptz not null default now(), ` +
      `"deleted_at" timestamptz null, ` +
      `constraint "promotion_meta_pkey" primary key ("id")` +
      `);`
    );
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_promotion_meta_promotion_id" ON "promotion_meta" ("promotion_id") WHERE deleted_at IS NULL;`
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "promotion_meta" cascade;`);
  }
}
