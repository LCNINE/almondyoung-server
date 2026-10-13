import { sql } from 'drizzle-orm';
import { DbTx } from '../../../inventory/schema/inventory.schema';

/** «출처가 있으면 구성 행 ≥ 1, 없으면 0»(#1063 스펙 §4.3)을 어긴 라인 id. 통합 스펙이 시나리오 끝에 0 을 확인한다. */
export async function findCompositionInvariantViolations(tx: DbTx): Promise<string[]> {
  const rows = await tx.execute<{ id: string }>(sql`
    SELECT l.id
    FROM sales_order_lines l
    LEFT JOIN sales_order_line_compositions c ON c.sales_order_line_id = l.id
    GROUP BY l.id, l.composition_source
    HAVING (l.composition_source IS NULL) <> (count(c.id) = 0)
  `);
  return rows.map((row) => row.id);
}
