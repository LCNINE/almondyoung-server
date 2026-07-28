import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * /store/products-sorted 가 product_sort_index 와 product_category_product 를 직접 조인하면서
 * 필요해진 인덱스. product_category_product 의 PK 는 (product_id, product_category_id) 순서라
 * "이 카테고리에 속한 상품" 방향 조회에 못 쓰이고 seq scan(3.7만 행) 으로 떨어진다.
 *
 * product 모듈 소유 테이블이지만 인덱스 추가는 비파괴적이고, 이 인덱스를 필요로 하는 쿼리가
 * 이 모듈에 있으므로 여기서 관리한다.
 */
export class Migration20260728000000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_pcp_category_product" ON "product_category_product" ("product_category_id", "product_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "idx_pcp_category_product";`);
  }

}
