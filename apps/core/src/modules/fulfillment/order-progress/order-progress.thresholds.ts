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
  cancel_request: ['settle_in_progress', 'settle_delayed', 'settle_refused'],
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

/**
 * 상자 하나의 판정(리컨실러 스펙 §11.5 «상자별 결과»)에서 상자 규칙이 겨눌 수 있는 단계·세부 상태. 주문 어휘의 부분집합이다 —
 * accept·fo·cancel_request·return_exchange 는 주문 단위 판정이라 상자에 없고, 직배(drop_ship_*)는 상자가 없다.
 * unclassified 는 상자 상태·recovery_code 가 그대로 나오는 열린 값이라 겨눌 규칙이 생길 때 더한다.
 */
export const SHIPMENT_STAGES = ['reserve', 'plan', 'waybill', 'pick', 'dispatch', 'track', 'cancel'] as const;
export type ShipmentStage = (typeof SHIPMENT_STAGES)[number];

export const SHIPMENT_STATES = {
  reserve: ['created', 'partially_reserved'],
  plan: ['awaiting_plan'],
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
  dispatch: ['awaiting_dispatch'],
  track: ['shipped', 'in_transit', 'failed'],
  cancel: ['CANCEL_REPLAN_PENDING'],
} as const satisfies { [S in ShipmentStage]: readonly OrderProgressStateOf<S>[] };
export type ShipmentStateOf<S extends ShipmentStage> = (typeof SHIPMENT_STATES)[S][number];

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** 정산 중인 채널 취소 요청이 «환불 지연»이 되는 시간 — 확정 시각(요청 행 created_at)부터(#1016 36번 재설계 §5.1).
 *  판정 SQL·actions API·admin-web 뷰가 같은 값을 읽는다 — 스토어프론트 «지연»과 보드 «환불 지연»이 같은 순간에 바뀌게 */
export const SETTLE_DELAYED_AFTER_MS = 30 * MINUTE;
/** 전자상거래법 18조 2항 «3영업일 이내 환급». v1 은 주말만 뺀다(공휴일은 범위 밖, 스펙 §13) */
export const SETTLE_DEADLINE_BUSINESS_DAYS = 3;
/** 막 (다시) 시작한 정산은 이만큼 건드리지 않는다 — 채널이 아직 처리 중일 수 있다(리컨실러 36번) */
export const SETTLEMENT_REISSUE_GRACE_MS = MINUTE;

const KST_OFFSET_MS = 9 * HOUR; // 한국은 일광절약시간이 없다

/** from + n 영업일(같은 시각). 요일은 한국 시간으로 센다 — 런타임 TZ(jest·라이브는 UTC)를 읽지 않는다 */
export function addBusinessDaysKst(from: Date, days: number): Date {
  let at = from.getTime();
  let left = days;
  while (left > 0) {
    at += DAY;
    const weekday = new Date(at + KST_OFFSET_MS).getUTCDay();
    if (weekday !== 0 && weekday !== 6) left--;
  }
  return new Date(at);
}

export function settlementDeadline(confirmedAt: Date): Date {
  return addBusinessDaysKst(confirmedAt, SETTLE_DEADLINE_BUSINESS_DAYS);
}

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
  // 단계 기본값 — 정산 중 상태는 전부 STUCK_AFTER_MS_BY_STATE 가 덮는다(키는 Record 라 남는다)
  cancel_request: 5 * MINUTE,
  cancel: HOUR,
  return_exchange: 7 * DAY,
  unclassified: 0,
};

/**
 * 세부 상태가 단계 기준을 덮는 칸. null = 갇힘으로 보지 않는다.
 * 정산 중은 «환불 지연»(확정 + SETTLE_DELAYED_AFTER_MS)이 될 때까지 운영자 일이 아니고, 지연·거절은 그 자체가 «기준을 넘었다»는 뜻이다(스펙 §5.2·§8.1).
 */
export const STUCK_AFTER_MS_BY_STATE: Partial<Record<OrderProgressState, number | null>> = {
  settle_in_progress: null,
  settle_delayed: 0,
  settle_refused: 0,
};

function hasStateOverride(state: string): state is keyof typeof STUCK_AFTER_MS_BY_STATE {
  return Object.hasOwn(STUCK_AFTER_MS_BY_STATE, state);
}

export function stuckAfterMs(stage: OrderProgressStage, state: string | null): number | null {
  if (state !== null && hasStateOverride(state)) return STUCK_AFTER_MS_BY_STATE[state] ?? null;
  return STUCK_AFTER_MS[stage];
}

export function stuckCutoff(stage: OrderProgressStage, now: Date): Date {
  return new Date(now.getTime() - STUCK_AFTER_MS[stage]);
}

export function isStuck(stage: OrderProgressStage, enteredAt: Date, now: Date, state: string | null = null): boolean {
  const ms = stuckAfterMs(stage, state);
  if (ms === null) return false;
  return enteredAt.getTime() < now.getTime() - ms;
}
