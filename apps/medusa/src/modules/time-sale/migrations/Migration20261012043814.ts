import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261012043814 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "time_sale" add column if not exists "product_order" text[] not null default '{}';`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "time_sale" drop column if exists "product_order";`);
  }

}
