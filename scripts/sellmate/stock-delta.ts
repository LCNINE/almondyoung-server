/**
 * 셀메이트 스크립트가 재고 원장에 delta 를 적는 한 자리 — sync-stock 과 handover-stock-addback 이 같이 쓴다.
 *
 * InventoryCommandService.adjustUp/Down 과 같은 모양을 raw SQL 로 재현한다:
 *   - 증가: ADJUST_UP stock_events 한 행 + 입고기본존 ON_HAND 원장 upsert(qty += delta)
 *   - 감소: 잠근 위치들에서 많은 곳부터 ADJUST_DOWN 한 행씩 + 조건부 차감(qty >= take), 영향 행 1 검증
 * 이벤트의 `reason` 이 출처(`source`)다 — sync 는 'sellmate-sync', 넘겨받은 주문 되돌리기는 'sellmate-handover'.
 *
 * 호출자는 트랜잭션 안에서 부른다(실패하면 호출자의 트랜잭션째 롤백된다). 이 함수는 그 SKU 의 부천 ON_HAND 원장 행을
 * FOR UPDATE 로 잠그고 다시 읽은 값으로 차감을 나눈다 — 호출자가 이미 같은 트랜잭션에서 잠갔다면 같은 행을 다시 읽을 뿐이다.
 *
 * ⚠️ stock_ledgers.version 은 올리지 않는다 — 추출 전 sync-stock 과 같다(동작 불변). 앱(stock-event.store.ts)은 올린다.
 */
import { Sql } from 'postgres';

// seeding 의 FIXED_UUIDS 와 동일 (scripts/seeding/constants/uuids.ts)
export const BUCHEON_WAREHOUSE_ID = process.env.WAREHOUSE_ID || '019d0001-0001-7000-a000-000000000001';
export const BUCHEON_RECEIVING_LOC_ID = process.env.LOCATION_ID || '019d0002-0001-7000-a000-000000000001';

export type StockDelta = {
  skuId: string;
  /** 양수면 ADJUST_UP, 음수면 ADJUST_DOWN, 0 이면 아무것도 안 한다 */
  delta: number;
  /** stock_events.reason 에 적는 출처 */
  source: string;
  /** 오류 문구에 쓸 품목 표시(없으면 skuId) */
  label?: string;
  /** 이벤트 occurred_at·원장 updated_at. 한 번의 실행이 같은 시각을 쓰게 호출자가 넘긴다(없으면 지금) */
  occurredAt?: Date;
};

export async function applyStockDelta(tx: Sql, { skuId, delta, source, label, occurredAt }: StockDelta): Promise<void> {
  if (delta === 0) return;
  if (!Number.isSafeInteger(delta)) throw new Error(`재고 delta 가 정수가 아니다: ${label ?? skuId} delta=${delta}`);
  const now = occurredAt ?? new Date();
  const code = label ?? skuId;

  const locs = await tx<{ location_id: string; qty: number }[]>`
    SELECT location_id, qty FROM stock_ledgers
    WHERE warehouse_id = ${BUCHEON_WAREHOUSE_ID} AND stock_state = 'ON_HAND' AND sku_id = ${skuId}
    ORDER BY qty DESC, location_id
    FOR UPDATE
  `;

  if (delta > 0) {
    await tx`
      INSERT INTO stock_events (sku_id, to_warehouse_id, to_location_id, to_state, transition_type, quantity, occurred_at, reason)
      VALUES (${skuId}, ${BUCHEON_WAREHOUSE_ID}, ${BUCHEON_RECEIVING_LOC_ID}, 'ON_HAND', 'ADJUST_UP', ${delta}, ${now}, ${source})
    `;
    await tx`
      INSERT INTO stock_ledgers (sku_id, warehouse_id, location_id, stock_state, qty, updated_at)
      VALUES (${skuId}, ${BUCHEON_WAREHOUSE_ID}, ${BUCHEON_RECEIVING_LOC_ID}, 'ON_HAND', ${delta}, ${now})
      ON CONFLICT (sku_id, warehouse_id, location_id, stock_state)
      DO UPDATE SET qty = stock_ledgers.qty + ${delta}, updated_at = ${now}
    `;
    return;
  }

  // 잠근 위치들에서 많은 곳부터 조건부 차감(qty >= take). 영향 행 검증으로 유실 방지.
  let remaining = -delta;
  for (const loc of locs) {
    if (remaining <= 0) break;
    const take = Math.min(loc.qty, remaining);
    if (take <= 0) continue;
    await tx`
      INSERT INTO stock_events (sku_id, from_warehouse_id, from_location_id, from_state, transition_type, quantity, occurred_at, reason)
      VALUES (${skuId}, ${BUCHEON_WAREHOUSE_ID}, ${loc.location_id}, 'ON_HAND', 'ADJUST_DOWN', ${take}, ${now}, ${source})
    `;
    const res = await tx`
      UPDATE stock_ledgers SET qty = qty - ${take}, updated_at = ${now}
      WHERE sku_id = ${skuId} AND warehouse_id = ${BUCHEON_WAREHOUSE_ID}
        AND location_id = ${loc.location_id} AND stock_state = 'ON_HAND' AND qty >= ${take}
    `;
    if (res.count !== 1) {
      // FOR UPDATE 로 잠갔으니 정상이면 발생 불가. 발생하면 경합/불일치 → 전체 롤백.
      throw new Error(`재고 차감 경합/불일치: code=${code} loc=${loc.location_id} take=${take} (영향행 ${res.count})`);
    }
    remaining -= take;
  }
  if (remaining > 0) {
    throw new Error(`차감할 재고 부족으로 목표 미달: code=${code} (${remaining} 부족) — 전체 롤백`);
  }
}
