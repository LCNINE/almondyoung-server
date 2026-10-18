import { sql, SQL } from 'drizzle-orm';
import { DbTx } from '../../inventory/schema/inventory.schema';

/**
 * 재고 대기 순번 — 예약 재시도 워커가 «오래 기다린 라인부터» 재고를 가져가게 하는 정렬 키.
 *
 * 우선순위: ① 확정 예약 / short-pick 으로 풀린 예약의 원 요청 시각 중 가장 이른 것
 * ② 분할이 물려준 `demand_requested_at` ③ 라인 `created_at`.
 * 예약이 하나도 없는 라인은 ①이 비므로, 분할로 새로 생긴 미예약 라인은 ②가 없으면
 * «지금» 으로 줄 맨 뒤에 선다.
 *
 * `line` 은 shipment_lines 의 SQL 별칭이다 (예: sql`sl`).
 */
export function reservationQueueKeySql(line: SQL): SQL {
  return sql`COALESCE((
    SELECT MIN(COALESCE(reservation.requested_at, reservation.created_at))
      FROM stock_reservations reservation
     WHERE reservation.target_type = 'SHIPMENT_LINE'
       AND reservation.shipment_line_id = ${line}.id
       AND (
         reservation.status = 'confirmed'
         OR (
           reservation.status = 'released'
           AND reservation.state_reason LIKE 'short-pick:%'
         )
       )
  ), ${line}.demand_requested_at, ${line}.created_at)`;
}

/**
 * 라인 하나의 지금 순번. 분할이 새 라인에 물려줄 값을 구할 때 쓴다 — 원래 라인의
 * 수량을 줄이거나 예약을 옮기기 «전에» 불러야 원래 라인의 예약 행이 그대로 남아 있다.
 */
export async function loadReservationQueueKey(tx: DbTx, shipmentLineId: string): Promise<Date> {
  const rows = await tx.execute(
    sql`SELECT ${reservationQueueKeySql(sql`sl`)} AS queue_key FROM shipment_lines sl WHERE sl.id = ${shipmentLineId}`,
  );
  // execute() 원시 결과 타이핑 — order-progress.reader.ts 와 같은 문서화된 캐스트.
  const [row] = rows as unknown as Array<{ queue_key: Date | string }>;
  if (!row) throw new Error(`shipment line not found: ${shipmentLineId}`);
  return new Date(row.queue_key);
}
