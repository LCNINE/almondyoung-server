import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import type { LineItemReservationResult } from '../../../workflows/line-item-reservation/plan';
import { setLineItemReservationsWorkflow } from '../../../workflows/line-item-reservation/workflows';
import type { AdminListLineItemReservationsType, AdminSetLineItemReservationsType } from './validators';

/**
 * 줄마다 예약을 판매 단위 N 으로 설정한다 (#1247). 호출자는 channel-adapter 의 예약 투영(이벤트 워커·하루 대사).
 *
 * 응답은 언제나 200 + 줄마다 결과다(ADR-0040 배치 수신: 검증 + 워크플로 한 번 + 건별 결과). 묶음 쓰기가
 * 되감기면 어느 줄도 쓰이지 않았으므로 모든 줄을 `error` 로 돌려준다 — 호출자는 `error` 를 다시 시도한다.
 * 그때 지금 값은 모르므로 quantity_before·after 는 0 이다(`error` 줄의 수량은 읽지 않는다).
 */
export async function POST(req: MedusaRequest<AdminSetLineItemReservationsType>, res: MedusaResponse) {
  const { items } = req.validatedBody;
  try {
    const { result } = await setLineItemReservationsWorkflow(req.scope).run({ input: { items } });
    return res.json({ results: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);
    logger.warn(`[line-item-reservations] 묶음 ${items.length}줄 쓰기 실패: ${message}`);
    const results: LineItemReservationResult[] = items.map((item) => ({
      line_item_id: item.line_item_id,
      outcome: 'error',
      quantity_before: 0,
      quantity_after: 0,
      message,
    }));
    return res.json({ results });
  }
}

type ReservationRow = { id: string; line_item_id: string; quantity: string | number; order_created_at: Date | string };

/**
 * 주문 생성 시각이 `order_created_from` 이후인 주문 줄의 살아 있는 예약, 예약 id 순 커서.
 * 대사의 Medusa 쪽 후보다(core 가 «잡았다»고 하는데 Medusa 가 계속 잡고 있는 줄을 찾는다).
 *
 * 예약 → 줄 → 주문은 모듈 경계(inventory ↔ order)를 넘고 링크가 없어 SQL 로 읽는다(읽기만).
 * 수량은 판매 단위로 돌려준다 — 쓰기 라우트의 quantity 와 같은 단위여야 대사가 그대로 비교한다.
 * order_item 은 주문 버전마다 행이 있으므로 줄의 주문은 하나만 집는다.
 */
const LIST_SQL = `
  select r.id,
         r.line_item_id,
         r.quantity / coalesce(nullif(pvii.required_quantity, 0), 1) as quantity,
         o.created_at as order_created_at
    from reservation_item r
    join order_line_item li on li.id = r.line_item_id and li.deleted_at is null
    join lateral (
      select oi.order_id from order_item oi
       where oi.item_id = li.id and oi.deleted_at is null
       order by oi.version desc
       limit 1
    ) oi on true
    join "order" o on o.id = oi.order_id and o.deleted_at is null
    left join product_variant_inventory_item pvii
      on pvii.variant_id = li.variant_id
     and pvii.inventory_item_id = r.inventory_item_id
     and pvii.deleted_at is null
   where r.deleted_at is null
     and r.line_item_id is not null
     and o.created_at >= ?
     and r.id > ?
   order by r.id
   limit ?
`;

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  // validatedQuery 는 Medusa 가 느슨한 타입으로 준다. 값은 미들웨어의 AdminListLineItemReservations 가 이미 검증했다.
  const query = req.validatedQuery as AdminListLineItemReservationsType;
  const knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const { rows } = await knex.raw(LIST_SQL, [new Date(query.order_created_from), query.after_id ?? '', query.limit]);
  const reservations = (rows as ReservationRow[]).map((row) => ({
    id: row.id,
    line_item_id: row.line_item_id,
    quantity: Number(row.quantity),
    order_created_at: new Date(row.order_created_at).toISOString(),
  }));
  const next_after_id = reservations.length === query.limit ? reservations[reservations.length - 1].id : null;
  return res.json({ reservations, next_after_id });
}
