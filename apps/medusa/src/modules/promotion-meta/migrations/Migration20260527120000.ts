import { Migration } from '@medusajs/framework/mikro-orm/migrations';

export class Migration20260527120000 extends Migration {
  override async up(): Promise<void> {
    // 운영 DB에 미이관 값이 있으면 명시적으로 실패 — backfill 후 재실행 필요
    this.addSql(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM "promotion_meta" WHERE "max_uses_per_customer" IS NOT NULL LIMIT 1
        ) THEN
          RAISE EXCEPTION 'backfill required: promotion_meta.max_uses_per_customer 에 값이 있습니다. campaign budget(use_by_attribute) 이관 후 재실행하세요.';
        END IF;
      END $$;
    `);
    this.addSql(`ALTER TABLE "promotion_meta" DROP COLUMN IF EXISTS "max_uses_per_customer";`);
  }

  override async down(): Promise<void> {
    this.addSql(`ALTER TABLE "promotion_meta" ADD COLUMN IF NOT EXISTS "max_uses_per_customer" numeric NULL;`);
  }
}
