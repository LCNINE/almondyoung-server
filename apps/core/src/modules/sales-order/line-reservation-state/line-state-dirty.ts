import { and, inArray, isNotNull, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';

/**
 * 판매주문 줄 상태(예약·출고·전달·출고 전 취소)가 바뀐 주문에 «더러움» 표시를 한다 (#1247, 스펙 §5-1).
 * 표시 = `sales_order_line_state_marks` 에 행 하나 INSERT. `sales_orders` 행은 건드리지 않는다 —
 * 그 행을 잠그면 FO 를 먼저 잠근 경로(예약·출고)와 판매주문을 먼저 잠근 경로(취소)의 잠금 순서가 뒤집혀 교착이 난다.
 * 바뀌는 쓰기와 **같은 트랜잭션**에서 부른다 — 롤백된 변화는 표시도 사라지고, 커밋된 변화는 표시가 유실되지 않는다.
 *
 * 1분 폴러(`LineStatePublisher`)가 표시된 주문마다 버전을 올리고 스냅샷을 outbox 로 낸 뒤 그때 본 표시를 지운다.
 * 한 트랜잭션에서 여러 번 표시해도 폴러는 이벤트 하나를 낸다. 표시 지점은 `line-state-dirty.guard.spec.ts` 가 지킨다.
 */
export async function markLineStateDirty(tx: DbTx, salesOrderIds: readonly string[]): Promise<void> {
  const ids = [...new Set(salesOrderIds)].sort();
  if (ids.length === 0) return;
  await tx.insert(wmsTables.salesOrderLineStateMarks).values(ids.map((salesOrderId) => ({ salesOrderId })));
}

/**
 * FO 들의 판매주문에 표시한다 — `INSERT … SELECT` 한 문(FO → 판매주문 조회를 따로 하지 않는다).
 * `reprojectFulfillmentOrders` 가 부르는 뜨거운 경로라 문장 하나로 둔다. 판매주문 없는 FO 는 건너뛴다.
 */
export async function markLineStateDirtyForFulfillmentOrders(
  tx: DbTx,
  fulfillmentOrderIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(fulfillmentOrderIds)].sort();
  if (ids.length === 0) return;
  const marks = wmsTables.salesOrderLineStateMarks;
  const fo = wmsTables.fulfillmentOrders;
  // drizzle 의 insert().select() 는 표의 모든 열(id 포함)을 채우라고 요구한다 — 열 하나만 넣는 INSERT … SELECT 는 sql 로 쓴다.
  await tx.execute(sql`
    INSERT INTO ${marks} (${sql.identifier(marks.salesOrderId.name)})
    SELECT DISTINCT ${fo.salesOrderId}
    FROM ${fo}
    WHERE ${and(inArray(fo.id, ids), isNotNull(fo.salesOrderId))}
    ORDER BY 1
  `);
}
