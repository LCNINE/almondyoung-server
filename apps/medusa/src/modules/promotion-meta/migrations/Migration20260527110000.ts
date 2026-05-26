import { Migration } from '@medusajs/framework/mikro-orm/migrations';

export class Migration20260527110000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `CREATE TABLE IF NOT EXISTS "promotion_issue_log" (` +
      `"id" text NOT NULL, ` +
      `"customer_id" text NOT NULL, ` +
      `"promotion_id" text NOT NULL, ` +
      `"trigger" text NOT NULL, ` +
      `"created_at" timestamptz NOT NULL DEFAULT now(), ` +
      `"updated_at" timestamptz NOT NULL DEFAULT now(), ` +
      `"deleted_at" timestamptz NULL, ` +
      `CONSTRAINT "promotion_issue_log_pkey" PRIMARY KEY ("id")` +
      `);`
    );
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_promotion_issue_log_unique" ` +
      `ON "promotion_issue_log" ("customer_id", "promotion_id") WHERE deleted_at IS NULL;`
    );
  }

  override async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "promotion_issue_log" CASCADE;`);
  }
}
