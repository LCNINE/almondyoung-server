/**
 * 정체 보드의 단계·결과·갇힘 기준(스펙 §4.1·§6). 리컨실러도 이 파일을 읽는다 — 기준을 두 벌 두지 않는다.
 * 단계·결과는 DB 에서 varchar 다(pgEnum 은 값을 더할 때마다 마이그가 필요하고 같은 실행에서 새 값을 못 쓴다).
 */
export const ORDER_PROGRESS_STAGES = [
  'accept',
  'fo',
  'reserve',
  'plan',
  'waybill',
  'pick',
  'dispatch',
  'track',
  'cancel_request',
  'cancel',
  'return_exchange',
  'unclassified',
] as const;
export type OrderProgressStage = (typeof ORDER_PROGRESS_STAGES)[number];

export const ORDER_PROGRESS_OUTCOMES = ['delivered', 'external_shipped', 'not_required', 'cancelled'] as const;
export type OrderProgressOutcome = (typeof ORDER_PROGRESS_OUTCOMES)[number];

export function isOrderProgressStage(value: string): value is OrderProgressStage {
  return (ORDER_PROGRESS_STAGES as readonly string[]).includes(value);
}

/**
 * 단계마다 규칙이 겨눌 수 있는 세부 상태(리컨실러 스펙 2026-10-08 §11.3). 리컨실러 규칙의 칸이 이 어휘로 타입 검사된다 —
 * string[] 이던 때는 오타가 «영원히 후보 없음»이 되고 deleteDeparted 가 그 규칙의 행을 조용히 지웠다.
 * 판정 SQL 은 이 밖의 값도 낸다(그 밖의 recovery_code, 분류 안 된 상자 상태) — 그 칸을 겨눌 규칙이 생길 때 더한다.
 * 값이 판정 SQL 과 어긋나지 않는지는 order-progress.thresholds.spec.ts 가 지킨다.
 */
export const ORDER_PROGRESS_STATES = {
  accept: ['no_backlog'],
  // backlog 상태. completed 는 FO 가 있어 단위로 넘어가고, not_required 는 종료(outcome)라 여기 없다
  fo: ['pending', 'processing', 'awaiting_matching', 'failed'],
  reserve: ['created', 'partially_reserved'],
  plan: ['awaiting_plan'],
  // 활성 송장 상태(종결 voided·failed·abandoned 는 활성이 아니다), 없으면 none
  waybill: ['none', 'pending', 'allocated'],
  pick: [
    'queued',
    'picking',
    'ready_to_pack',
    'packing',
    'withdrawing',
    'short_pick_recovery',
    'awaiting_batch',
    'CONSOLIDATION_PENDING',
  ],
  dispatch: ['awaiting_dispatch', 'drop_ship_pending'],
  track: ['shipped', 'in_transit', 'failed', 'drop_ship_forwarded'],
  cancel_request: ['cancel_requested', 'cancel_edited'],
  // 취소된 주문의 열린 상자·예약. 열린 상자의 recovery_code 가 그대로 나올 수도 있다
  cancel: ['CANCEL_REPLAN_PENDING', 'open_shipment', 'open_reservation'],
  // 열린(완료·거절·취소 아닌) 반품·교환
  return_exchange: [
    'return:requested',
    'return:approved',
    'return:collection_pending',
    'return:collected',
    'return:inspected',
    'return:refund_pending',
    'exchange:requested',
    'exchange:approved',
    'exchange:collection_pending',
    'exchange:collected',
    'exchange:inspected',
    'exchange:refund_pending',
  ],
  unclassified: ['no_units', 'fo_missing'],
} as const satisfies Record<OrderProgressStage, readonly string[]>;
export type OrderProgressStateOf<S extends OrderProgressStage> = (typeof ORDER_PROGRESS_STATES)[S][number];
export type OrderProgressState = OrderProgressStateOf<OrderProgressStage>;

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** 달력 시간. 주말·공휴일을 빼지 않는다(스펙 D6). */
export const STUCK_AFTER_MS: Record<OrderProgressStage, number> = {
  accept: HOUR,
  fo: DAY,
  reserve: 3 * DAY,
  plan: DAY,
  waybill: HOUR,
  pick: 12 * HOUR,
  dispatch: HOUR,
  track: 5 * DAY,
  // 채널 취소 요청(#1016 35번 §5.5) — 보통 몇 초. 5분이면 명령이 처리되지 않았거나 결과가 유실됐다.
  cancel_request: 5 * MINUTE,
  cancel: HOUR,
  return_exchange: 7 * DAY,
  unclassified: 0,
};

export function stuckCutoff(stage: OrderProgressStage, now: Date): Date {
  return new Date(now.getTime() - STUCK_AFTER_MS[stage]);
}

export function isStuck(stage: OrderProgressStage, enteredAt: Date, now: Date): boolean {
  return enteredAt.getTime() < stuckCutoff(stage, now).getTime();
}
