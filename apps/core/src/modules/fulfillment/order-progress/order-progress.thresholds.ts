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
