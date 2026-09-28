import { Migration } from '@medusajs/framework/mikro-orm/migrations';

export class Migration20260922090000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`ALTER TABLE "coupon_grant" ADD COLUMN IF NOT EXISTS "expiry_notified_at" timestamptz NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`ALTER TABLE "coupon_grant" DROP COLUMN IF EXISTS "expiry_notified_at";`);
  }
}
