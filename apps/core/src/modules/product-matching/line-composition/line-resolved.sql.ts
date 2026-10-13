import { SQL, getTableName, sql } from 'drizzle-orm';
import { wmsTables } from '../../inventory/schema/inventory.schema';

/**
 * «이 라인은 매칭이 해결됐나» — resolveLineComposition 의 SQL 짝(#1063 스펙 §5.2). TS 에서 frozen·follow·void 인 라인이 참이다.
 * 목록 화면은 SQL 로 걸러야 해서 이 술어가 따로 있다 — 둘이 같은 답을 내는지는 line-resolved.parity.integration.spec.ts 가 지킨다.

 * 이 술어는 «매칭이 해결됐나»에 답할 뿐 «이 라인이 물리인가»에 답하지 않는다 — 디지털 라인은 여기서 판정하지 않는다(TS 는 digital 로 가른다).
 *
 * 조인을 요구하지 않는다(상관 서브쿼리) — 조인을 요구하면 쓰는 쿼리마다 모양이 갈린다. `sales_order_lines` 가 별칭 없이
 * FROM 에 있는 쿼리에서만 쓴다. 서브쿼리 별칭(resolved_pm·resolved_k)은 바깥 쿼리가 product_matchings 를 조인해도 섞이지 않게 붙였다.
 */
export function lineResolvedSql(): SQL<boolean> {
  const line = wmsTables.salesOrderLines;
  // 단일 테이블 select 에서 drizzle 은 컬럼의 테이블 한정자를 떼 버린다 — 서브쿼리 안의 variant_id 가 resolved_pm 쪽으로
  // 읽혀 항상 참이 되므로 바깥 컬럼은 테이블 이름을 직접 적는다.
  const outerVariantId = sql`${sql.identifier(getTableName(line))}.${sql.identifier(line.variantId.name)}`;
  return sql<boolean>`(${line.compositionSource} IS NOT NULL OR EXISTS (
    SELECT 1 FROM product_matchings resolved_pm
    WHERE resolved_pm.variant_id = ${outerVariantId}
      AND resolved_pm.status = 'matched'
      AND (
        resolved_pm.strategy = 'void'
        OR (
          resolved_pm.strategy = 'variant'
          AND EXISTS (SELECT 1 FROM product_variant_sku_links resolved_k WHERE resolved_k.product_matching_id = resolved_pm.id)
        )
      )
  ))`;
}
