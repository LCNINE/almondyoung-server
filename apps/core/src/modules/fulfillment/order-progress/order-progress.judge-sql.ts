import { SQL, sql } from 'drizzle-orm';

/** 대표 단위를 고르는 순서: 분류 안 됨 > 취소 > 가장 뒤처진 단계. 주문으로 접을 때와 상자로 접을 때 같은 순서를 쓴다 */
const unitStagePriority = (stage: SQL) => sql`CASE ${stage}
  WHEN 'unclassified' THEN 0 WHEN 'cancel' THEN 1 WHEN 'reserve' THEN 2 WHEN 'plan' THEN 3
  WHEN 'waybill' THEN 4 WHEN 'pick' THEN 5 WHEN 'dispatch' THEN 6 WHEN 'track' THEN 7 ELSE 99
END`;

/**
 * 판정의 공통 CTE(so … decided). 주문으로 접기(judgedRowsSql)와 상자별 결과(judgedShipmentsSql)가 같이 읽는다 —
 * 판정 정의는 이 한 벌이다(리컨실러 스펙 §11.5). units 는 상자 하나 × 주문 하나(직배는 shipment_id NULL).
 */
function judgeCtes(scope: SQL, now: SQL): SQL {
  return sql`
    WITH so AS (
      SELECT s.id, s.status::text AS status, s.sales_channel::text AS sales_channel,
             s.order_date, s.created_at, s.updated_at
        FROM sales_orders s
       WHERE s.id IN (${scope})
    ),
    bl AS (
      SELECT DISTINCT ON (b.sales_order_id) b.sales_order_id, b.status::text AS status, b.created_at
        FROM fulfillment_order_creation_backlogs b
        JOIN so ON so.id = b.sales_order_id
       ORDER BY b.sales_order_id, b.created_at DESC
    ),
    fo AS (
      SELECT f.id, f.sales_order_id, f.status::text AS status, f.fulfillment_mode::text AS mode,
             f.direct_ship_status::text AS ds, f.created_at, f.updated_at
        FROM fulfillment_orders f
        JOIN so ON so.id = f.sales_order_id
    ),
    -- 상자 하나 × 그 상자에 라인이 있는 판매주문 하나. 합포장 상자는 주문마다 한 행씩 나온다.
    box AS (
      SELECT fo.sales_order_id, s.id AS shipment_id, s.status::text AS status, s.recovery_code,
             s.opened_at, s.planned_at, s.shipped_at,
             bool_or(fo.status IN ('created', 'partially_reserved')) AS under_reserved,
             bool_or(fo.status = 'partially_reserved') AS partially_reserved,
             min(fo.created_at) AS fo_created_at
        FROM shipments s
        JOIN shipment_lines sl ON sl.shipment_id = s.id
        JOIN fulfillment_order_items foi ON foi.id = sl.fulfillment_order_item_id
        JOIN fo ON fo.id = foi.fulfillment_order_id
       WHERE s.status NOT IN ('canceled', 'superseded')
       GROUP BY fo.sales_order_id, s.id
    ),
    -- 활성 작업 항목이 있으면 그것, 없으면 마지막 completed. excluded(배치에서 빠짐)는 보지 않는다.
    wi AS (
      SELECT DISTINCT ON (w.shipment_id) w.shipment_id, w.status::text AS status, w.picker_claimed_at, w.completed_at
        FROM outbound_batch_work_items w
       WHERE w.shipment_id IN (SELECT shipment_id FROM box) AND w.status <> 'excluded'
       ORDER BY w.shipment_id, (w.status = 'completed') ASC, w.created_at DESC
    ),
    -- 활성 송장 = 종결 상태(voided·failed·abandoned)가 아닌 것(waybill.constants WAYBILL_TERMINAL_STATUSES).
    wb AS (
      SELECT DISTINCT ON (x.shipment_id) x.shipment_id, x.status::text AS status
        FROM waybills x
       WHERE x.shipment_id IN (SELECT shipment_id FROM box) AND x.status NOT IN ('voided', 'failed', 'abandoned')
       ORDER BY x.shipment_id, x.created_at DESC
    ),
    box_kind AS (
      SELECT b.*, wi.status AS wi_status, wi.picker_claimed_at, wi.completed_at, wb.status AS wb_status,
             CASE
               WHEN b.status IN ('draft', 'planned', 'recovery_required') AND b.recovery_code = 'CANCEL_REPLAN_PENDING' THEN 'cancel_replan'
               WHEN b.status IN ('draft', 'planned', 'recovery_required') AND b.recovery_code = 'CONSOLIDATION_PENDING' THEN 'consolidation'
               WHEN b.status = 'recovery_required'
                 OR (b.status IN ('draft', 'planned') AND b.recovery_code IS NOT NULL) THEN 'recovery_unknown'
               WHEN b.status = 'draft' AND b.under_reserved THEN 'reserve'
               WHEN b.status = 'draft' THEN 'plan'
               WHEN b.status = 'planned'
                 AND wi.status IN ('queued', 'picking', 'ready_to_pack', 'packing', 'withdrawing', 'short_pick_recovery') THEN 'picking'
               -- 회수 뒤 다시 계획된 상자의 옛 completed 는 세지 않는다(완료가 이번 계획보다 뒤여야 한다)
               WHEN b.status = 'planned' AND wi.status = 'completed'
                 AND wi.completed_at >= coalesce(b.planned_at, '-infinity'::timestamptz) THEN 'dispatch'
               WHEN b.status = 'planned' AND (wb.status IS NULL OR wb.status NOT IN ('registered', 'used')) THEN 'waybill'
               WHEN b.status = 'planned' THEN 'awaiting_batch'
               WHEN b.status IN ('shipped', 'in_transit', 'failed') THEN 'track'
               WHEN b.status = 'delivered' THEN 'done'
               ELSE 'recovery_unknown'
             END AS kind
        FROM box b
        LEFT JOIN wi ON wi.shipment_id = b.shipment_id
        LEFT JOIN wb ON wb.shipment_id = b.shipment_id
    ),
    units AS (
      SELECT k.sales_order_id, k.shipment_id,
             CASE k.kind
               WHEN 'cancel_replan' THEN 'cancel' WHEN 'consolidation' THEN 'pick' WHEN 'recovery_unknown' THEN 'unclassified'
               WHEN 'reserve' THEN 'reserve' WHEN 'plan' THEN 'plan' WHEN 'picking' THEN 'pick'
               WHEN 'dispatch' THEN 'dispatch' WHEN 'waybill' THEN 'waybill' WHEN 'awaiting_batch' THEN 'pick'
               WHEN 'track' THEN 'track' ELSE 'done'
             END AS stage,
             CASE k.kind
               WHEN 'cancel_replan' THEN k.recovery_code WHEN 'consolidation' THEN k.recovery_code
               WHEN 'recovery_unknown' THEN coalesce(k.recovery_code, k.status)
               WHEN 'reserve' THEN CASE WHEN k.partially_reserved THEN 'partially_reserved' ELSE 'created' END
               WHEN 'plan' THEN 'awaiting_plan' WHEN 'picking' THEN k.wi_status
               WHEN 'dispatch' THEN 'awaiting_dispatch' WHEN 'waybill' THEN coalesce(k.wb_status, 'none')
               WHEN 'awaiting_batch' THEN 'awaiting_batch' WHEN 'track' THEN k.status ELSE NULL
             END AS state,
             CASE k.kind
               WHEN 'reserve' THEN k.fo_created_at WHEN 'plan' THEN k.opened_at
               WHEN 'picking' THEN coalesce(k.picker_claimed_at, k.planned_at)
               WHEN 'dispatch' THEN k.completed_at
               WHEN 'waybill' THEN k.planned_at WHEN 'awaiting_batch' THEN k.planned_at
               WHEN 'consolidation' THEN k.planned_at
               WHEN 'track' THEN k.shipped_at ELSE NULL
             END AS est
        FROM box_kind k
      UNION ALL
      SELECT fo.sales_order_id, NULL::uuid AS shipment_id,
             CASE fo.ds WHEN 'pending' THEN 'dispatch' WHEN 'forwarded' THEN 'track' ELSE 'done' END,
             'drop_ship_' || fo.ds,
             CASE fo.ds WHEN 'pending' THEN fo.created_at ELSE fo.updated_at END
        FROM fo
       WHERE fo.mode = 'drop_ship' AND fo.ds IS NOT NULL AND fo.ds <> 'canceled'
    ),
    -- 주문의 대표 단위: 분류 안 됨 > 취소 > 가장 뒤처진 단계, 같은 단계면 가장 오래된 것
    rep AS (
      SELECT DISTINCT ON (u.sales_order_id) u.sales_order_id, u.stage, u.state, u.est
        FROM units u
       ORDER BY u.sales_order_id, ${unitStagePriority(sql`u.stage`)}, u.est ASC NULLS LAST
    ),
    open_box AS (
      SELECT DISTINCT ON (sales_order_id) sales_order_id, recovery_code
        FROM box WHERE status IN ('draft', 'planned', 'recovery_required')
       ORDER BY sales_order_id, (recovery_code IS NULL), recovery_code
    ),
    -- 상자 상태와 무관하게(취소된 상자 포함) 그 주문 라인에 걸린 확정 예약
    open_res AS (
      SELECT DISTINCT fo.sales_order_id
        FROM stock_reservations r
        JOIN shipment_lines sl ON sl.id = r.shipment_line_id
        JOIN fulfillment_order_items foi ON foi.id = sl.fulfillment_order_item_id
        JOIN fo ON fo.id = foi.fulfillment_order_id
       WHERE r.status = 'confirmed'
    ),
    last_cancel AS (
      SELECT c.sales_order_id, max(c.occurred_at) AS at
        FROM sales_order_cancellations c
        JOIN so ON so.id = c.sales_order_id
       GROUP BY c.sales_order_id
    ),
    rx AS (
      SELECT DISTINCT ON (x.sales_order_id) x.sales_order_id, x.kind || ':' || x.status AS state, x.created_at
        FROM (
          SELECT r.sales_order_id, 'return' AS kind, r.status::text AS status, r.created_at
            FROM return_requests r JOIN so ON so.id = r.sales_order_id
           WHERE r.status NOT IN ('completed', 'rejected', 'cancelled')
          UNION ALL
          SELECT e.sales_order_id, 'exchange', e.status::text, e.created_at
            FROM exchange_requests e JOIN so ON so.id = e.sales_order_id
           WHERE e.status NOT IN ('completed', 'rejected', 'cancelled')
        ) x
       ORDER BY x.sales_order_id, x.created_at ASC
    ),
    has_fo AS (SELECT DISTINCT sales_order_id FROM fo),
    -- 열린 채널 취소 요청(#1016 35번) — 출고 보류 중이라 다른 단계는 멈춰 있다. 한 주문에 하나(부분 유니크).
    creq AS (
      SELECT a.sales_order_id, a.created_at,
             CASE WHEN a.metadata->'request'->>'stage' = 'edited' THEN 'cancel_edited' ELSE 'cancel_requested' END AS state
        FROM sales_order_amendments a
        JOIN so ON so.id = a.sales_order_id
       WHERE a.status = 'requested'
    ),
    decided AS (
      SELECT so.id, so.sales_channel, so.order_date, so.created_at AS so_created_at, so.updated_at AS so_updated_at,
             bl.status AS bl_status, bl.created_at AS bl_created_at,
             rep.stage AS rep_stage, rep.state AS rep_state, rep.est AS rep_est,
             lc.at AS cancel_at, rx.state AS rx_state, rx.created_at AS rx_at,
             (ob.sales_order_id IS NOT NULL) AS has_open_box, ob.recovery_code AS open_recovery_code,
             (hf.sales_order_id IS NOT NULL) AS has_fo,
             cr.state AS creq_state, cr.created_at AS creq_at,
             CASE
               WHEN cr.sales_order_id IS NOT NULL THEN 'cancel_request'
               WHEN so.status IN ('shipped', 'delivered') THEN 'external_shipped'
               WHEN so.status IN ('cancelled', 'timeout')
                 AND (ob.sales_order_id IS NOT NULL OR orr.sales_order_id IS NOT NULL) THEN 'cancel_open'
               WHEN so.status IN ('cancelled', 'timeout') THEN 'cancelled'
               WHEN rx.sales_order_id IS NOT NULL THEN 'return_exchange'
               WHEN bl.status = 'not_required' THEN 'not_required'
               WHEN hf.sales_order_id IS NULL AND bl.sales_order_id IS NULL THEN 'accept'
               WHEN hf.sales_order_id IS NULL AND bl.status <> 'completed' THEN 'fo'
               WHEN rep.stage IS NULL THEN 'unclassified'
               WHEN rep.stage = 'done' THEN 'delivered'
               ELSE 'unit'
             END AS rule
        FROM so
        LEFT JOIN bl ON bl.sales_order_id = so.id
        LEFT JOIN rep ON rep.sales_order_id = so.id
        LEFT JOIN open_box ob ON ob.sales_order_id = so.id
        LEFT JOIN open_res orr ON orr.sales_order_id = so.id
        LEFT JOIN last_cancel lc ON lc.sales_order_id = so.id
        LEFT JOIN rx ON rx.sales_order_id = so.id
        LEFT JOIN has_fo hf ON hf.sales_order_id = so.id
        LEFT JOIN creq cr ON cr.sales_order_id = so.id
    )
  `;
}

/**
 * 주문의 «지금 단계» 판정(스펙 §4). 정체 보드의 투영과 리컨실러가 함께 읽는 유일한 판정이다.
 * 집합 SQL 한 벌로 계산한다 — 행별 루프면 첫 백필(수만 건)이 크론 주기를 넘긴다.
 *
 * scope 는 판매주문 id 한 열을 돌려주는 SELECT. nowIso 는 추정 시각이 없을 때 쓰는 «지금»(ISO 문자열).
 * 결과 열: sales_order_id, sales_channel, ordered_at, stage, state, outcome, estimated_entered_at
 */
export function judgedRowsSql(scope: SQL, nowIso: string): SQL {
  const now = sql`${nowIso}::timestamptz`;
  return sql`
    ${judgeCtes(scope, now)}
    SELECT d.id AS sales_order_id,
           d.sales_channel,
           d.order_date AS ordered_at,
           CASE d.rule
             WHEN 'cancel_request' THEN 'cancel_request' WHEN 'cancel_open' THEN 'cancel' WHEN 'return_exchange' THEN 'return_exchange'
             WHEN 'accept' THEN 'accept' WHEN 'fo' THEN 'fo' WHEN 'unclassified' THEN 'unclassified'
             WHEN 'unit' THEN d.rep_stage ELSE NULL
           END AS stage,
           left(CASE d.rule
             WHEN 'cancel_request' THEN d.creq_state
             WHEN 'cancel_open' THEN coalesce(
               d.open_recovery_code,
               CASE WHEN d.has_open_box THEN 'open_shipment' ELSE 'open_reservation' END)
             WHEN 'return_exchange' THEN d.rx_state
             WHEN 'accept' THEN 'no_backlog'
             WHEN 'fo' THEN d.bl_status
             WHEN 'unclassified' THEN CASE WHEN d.has_fo THEN 'no_units' ELSE 'fo_missing' END
             WHEN 'unit' THEN d.rep_state ELSE NULL
           END, 64) AS state,
           CASE d.rule
             WHEN 'external_shipped' THEN 'external_shipped' WHEN 'cancelled' THEN 'cancelled'
             WHEN 'not_required' THEN 'not_required' WHEN 'delivered' THEN 'delivered' ELSE NULL
           END AS outcome,
           to_char(
             (CASE d.rule
                WHEN 'cancel_request' THEN d.creq_at
                WHEN 'cancel_open' THEN coalesce(d.cancel_at, d.so_updated_at)
                WHEN 'return_exchange' THEN d.rx_at
                WHEN 'accept' THEN d.so_created_at
                WHEN 'fo' THEN d.bl_created_at
                WHEN 'unit' THEN coalesce(d.rep_est, CASE WHEN d.rep_stage = 'cancel' THEN d.cancel_at END, ${now})
                ELSE ${now}
              END) AT TIME ZONE 'UTC',
             'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
           ) AS estimated_entered_at
      FROM decided d
  `;
}

/**
 * 상자별 판정(리컨실러 스펙 §11.5). 같은 CTE 의 units 를 상자로 접는다 — 판정 정의는 한 벌이다.
 * 상자 하나가 주문마다 한 행씩 나오므로(합포장) 주문으로 접을 때와 같은 우선순위로 대표 행을 고르고,
 * 그 상자에 라인이 있는 주문들과 그 주문 판정(decided.rule)을 배열로 싣는다 — 리컨실러가 D16 제외를 판단한다.
 * 직배 단위는 상자가 없어 나오지 않는다.
 */
export function judgedShipmentsSql(scope: SQL, nowIso: string): SQL {
  const now = sql`${nowIso}::timestamptz`;
  return sql`
    ${judgeCtes(scope, now)},
    su AS (
      SELECT u.shipment_id, u.sales_order_id, u.stage, u.state, u.est, d.rule AS order_rule
        FROM units u
        JOIN decided d ON d.id = u.sales_order_id
       WHERE u.shipment_id IS NOT NULL
    ),
    agg AS (
      SELECT su.shipment_id,
             array_agg(DISTINCT su.sales_order_id::text ORDER BY su.sales_order_id::text) AS sales_order_ids,
             array_agg(DISTINCT su.order_rule ORDER BY su.order_rule) AS order_rules
        FROM su
       GROUP BY su.shipment_id
    )
    SELECT DISTINCT ON (su.shipment_id)
           su.shipment_id,
           su.stage,
           left(su.state, 64) AS state,
           to_char(su.est AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS estimated_entered_at,
           agg.sales_order_ids,
           agg.order_rules
      FROM su
      JOIN agg ON agg.shipment_id = su.shipment_id
     ORDER BY su.shipment_id, ${unitStagePriority(sql`su.stage`)}, su.est ASC NULLS LAST
  `;
}

/**
 * 상자 후보를 찾을 범위: 진행 중 주문 + 그 주문과 상자를 나눈 주문. 나눈 주문을 넣는 이유 — 셀메이트로 출고돼 투영에서
 * 종료된 주문이 합포장 상자에 같이 있으면, 그 주문을 판정해야 D16 제외가 걸린다(빠지면 제외가 조용히 사라진다).
 */
export function openShipmentScopeSql(): SQL {
  return sql`
    SELECT p.sales_order_id FROM order_progress p WHERE p.outcome IS NULL
    UNION
    SELECT f2.sales_order_id
      FROM order_progress p
      JOIN fulfillment_orders f1 ON f1.sales_order_id = p.sales_order_id
      JOIN fulfillment_order_items i1 ON i1.fulfillment_order_id = f1.id
      JOIN shipment_lines l1 ON l1.fulfillment_order_item_id = i1.id
      JOIN shipments s ON s.id = l1.shipment_id AND s.status NOT IN ('canceled', 'superseded')
      JOIN shipment_lines l2 ON l2.shipment_id = s.id
      JOIN fulfillment_order_items i2 ON i2.id = l2.fulfillment_order_item_id
      JOIN fulfillment_orders f2 ON f2.id = i2.fulfillment_order_id
     WHERE p.outcome IS NULL AND f2.sales_order_id IS NOT NULL
  `;
}

/** 상자 하나의 지금 판정 범위: 그 상자에 라인이 있는 판매주문 전부(실행 직전 게이트, §11.4-3) */
export function shipmentScopeSql(shipmentId: string): SQL {
  return sql`
    SELECT DISTINCT f.sales_order_id
      FROM shipment_lines l
      JOIN fulfillment_order_items i ON i.id = l.fulfillment_order_item_id
      JOIN fulfillment_orders f ON f.id = i.fulfillment_order_id
     WHERE l.shipment_id = ${shipmentId}::uuid AND f.sales_order_id IS NOT NULL
  `;
}

/**
 * 갱신 대상(스펙 §5.2): 진행 중 행 + 행 없는 판매주문 + 직전 주기 뒤 판매주문·반품·교환·취소·변경 기록(취소 요청)이 바뀐 주문.
 * sinceIso 가 null 이면(첫 실행) 전 판매주문. 2분 겹침은 직전 주기의 스냅샷 뒤·evaluated_at 앞에 커밋된 변경을 놓치지 않기 위해서다.
 */
export function candidateIdsSql(sinceIso: string | null): SQL {
  if (sinceIso === null) return sql`SELECT s.id FROM sales_orders s`;
  const since = sql`(${sinceIso}::timestamptz - interval '2 minutes')`;
  return sql`
    SELECT s.id
      FROM sales_orders s
      LEFT JOIN order_progress p ON p.sales_order_id = s.id
     WHERE p.sales_order_id IS NULL OR p.outcome IS NULL OR s.updated_at > ${since}
    UNION SELECT r.sales_order_id FROM return_requests r WHERE r.updated_at > ${since}
    UNION SELECT e.sales_order_id FROM exchange_requests e WHERE e.updated_at > ${since}
    UNION SELECT c.sales_order_id FROM sales_order_cancellations c WHERE c.updated_at > ${since}
    UNION SELECT a.sales_order_id FROM sales_order_amendments a WHERE a.updated_at > ${since}
  `;
}
