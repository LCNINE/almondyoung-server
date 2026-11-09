import { inArray, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';

/**
 * 판매주문 줄 상태(예약·출고·전달·출고 전 취소)가 바뀐 주문에 «더러움» 표시를 한다 (#1247, 스펙 §5-1).
 * 표시 = `line_state_version + 1`. 버전이 `line_state_published_version` 보다 크면 1분 폴러
 * (`LineStatePublisher`)가 그 주문의 스냅샷을 outbox 로 낸다. 바뀌는 쓰기와 **같은 트랜잭션**에서 부른다 —
 * 그래야 롤백된 변화는 표시도 사라지고, 커밋된 변화는 표시가 유실되지 않는다.
 *
 * 한 트랜잭션에서 여러 번 불러도 이벤트는 하나다(폴러가 그때의 최신 버전 하나를 낸다).
 * id 는 정렬·중복 제거한다 — 같은 주문들을 표시하는 트랜잭션끼리 행 잠금을 같은 순서로 잡는다.
 * 표시 지점은 `line-state-dirty.guard.spec.ts` 가 지킨다.
 */
export async function markLineStateDirty(tx: DbTx, salesOrderIds: readonly string[]): Promise<void> {
  const ids = [...new Set(salesOrderIds)].sort();
  if (ids.length === 0) return;
  const so = wmsTables.salesOrders;
  await tx
    .update(so)
    .set({ lineStateVersion: sql`${so.lineStateVersion} + 1` })
    .where(inArray(so.id, ids));
}
