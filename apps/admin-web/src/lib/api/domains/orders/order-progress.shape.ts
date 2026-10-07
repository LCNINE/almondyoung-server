// src/lib/api/domains/orders/order-progress.shape.ts
//
// 정체 보드 응답 정형·표기 순수 함수. admin-web 은 컴포넌트 테스트가 안 되므로 화면이 읽는 판정은 전부 여기서 한다.
// 서버 원형: apps/core/src/modules/fulfillment/order-progress/order-progress.controller.ts

export type BoardStageKey =
  | 'collect'
  | 'accept'
  | 'fo'
  | 'reserve'
  | 'plan'
  | 'waybill'
  | 'pick'
  | 'dispatch'
  | 'track'
  | 'cancel_request'
  | 'cancel'
  | 'return_exchange'
  | 'unclassified';

export const BOARD_STAGES: { key: BoardStageKey; no: string; name: string }[] =
  [
    { key: 'collect', no: '0', name: '수집' },
    { key: 'accept', no: '1', name: '접수' },
    { key: 'fo', no: '2', name: 'FO 생성' },
    { key: 'reserve', no: '3', name: '예약' },
    { key: 'plan', no: '4', name: '계획' },
    { key: 'waybill', no: '5', name: '송장' },
    { key: 'pick', no: '6', name: '배치·피킹' },
    { key: 'dispatch', no: '7', name: '발송' },
    { key: 'track', no: '8', name: '추적' },
    { key: 'cancel_request', no: '', name: '취소 요청' },
    { key: 'cancel', no: '', name: '취소' },
    { key: 'return_exchange', no: '', name: '반품·교환' },
    { key: 'unclassified', no: '', name: '분류 안 됨' },
  ];

export interface StageSummary {
  stage: string;
  open: number;
  stuck: number;
  /** 리컨실러가 포기한 주문 수. 옛 core 응답엔 없다 */
  gaveUp?: number;
  oldestEnteredAt: string | null;
  states: { state: string; open: number; stuck: number; gaveUp?: number }[];
}
export type GaveUpMark = {
  rule: string;
  row: number;
  since: string;
  lastError: string | null;
};
export interface ProgressSummary {
  evaluatedAt: string | null;
  stages: StageSummary[];
}
export interface ProgressItem {
  salesOrderId: string;
  orderNo: string;
  channelOrderId: string;
  salesChannel: string;
  customerName: string | null;
  orderedAt: string;
  state: string | null;
  stageEnteredAt: string;
  stuck: boolean;
  gaveUp?: GaveUpMark[];
}
export interface ProgressPage {
  items: ProgressItem[];
  nextCursor: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function unwrap(body: unknown): unknown {
  return isRecord(body) && body.success === true && 'data' in body
    ? body.data
    : body;
}

export function toProgressSummary(body: unknown): ProgressSummary {
  const v = unwrap(body);
  if (!isRecord(v) || !Array.isArray(v.stages))
    return { evaluatedAt: null, stages: [] };
  return {
    evaluatedAt: typeof v.evaluatedAt === 'string' ? v.evaluatedAt : null,
    stages: v.stages as StageSummary[],
  };
}

export function toProgressPage(body: unknown): ProgressPage {
  const v = unwrap(body);
  if (!isRecord(v) || !Array.isArray(v.items))
    return { items: [], nextCursor: null };
  return {
    items: v.items as ProgressItem[],
    nextCursor: typeof v.nextCursor === 'string' ? v.nextCursor : null,
  };
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function formatDwell(ms: number): string {
  if (ms >= DAY) return `${Math.floor(ms / DAY)}일`;
  if (ms >= HOUR) {
    const h = Math.floor(ms / HOUR);
    const m = Math.floor((ms % HOUR) / MIN);
    return m ? `${h}시간 ${m}분` : `${h}시간`;
  }
  return `${Math.floor(ms / MIN)}분`;
}

/** 판정이 멈췄는지(스펙 §8.1). null(판정 전)도 stale — «갇힘 0»을 초록불로 보이지 않게. */
export function freshness(
  evaluatedAt: string | null,
  now: Date
): 'fresh' | 'stale' {
  if (!evaluatedAt) return 'stale';
  const age = now.getTime() - new Date(evaluatedAt).getTime();
  if (Number.isNaN(age)) return 'stale';
  return age > 5 * MIN ? 'stale' : 'fresh';
}

export type QueryState = { isError: boolean; hasData: boolean };

/** 머리말 문구·색(스펙 §8.1). 조회 실패는 이전 data 가 남아 있어도 빨강 — 실패 중에 초록으로 보이지 않게. */
export function headerStatus(
  summary: QueryState,
  evaluatedAt: string | null,
  now: Date
): { text: string; tone: 'normal' | 'stale' } {
  const ago =
    evaluatedAt && !Number.isNaN(new Date(evaluatedAt).getTime())
      ? `${formatDwell(now.getTime() - new Date(evaluatedAt).getTime())} 전 판정`
      : null;
  if (summary.isError)
    return {
      text: ago ? `판정 조회 실패 · 마지막 ${ago}` : '판정 조회 실패',
      tone: 'stale',
    };
  if (!summary.hasData) return { text: '', tone: 'normal' };
  return {
    text: ago ?? '판정 전',
    tone: freshness(evaluatedAt, now) === 'stale' ? 'stale' : 'normal',
  };
}

/** 칸에 찍을 건수. 값을 못 얻었으면 0 이 아니라 null(— 로 그린다). */
export function cellCount(
  value: number | undefined,
  available: boolean
): number | null {
  return available && value !== undefined ? value : null;
}

const STATE_LABELS: Record<string, string> = {
  cancel_requested: '취소 요청 미반영',
  cancel_edited: '수정됨 · 환불 미완',
  no_backlog: '출고 대기열 미적재',
  pending: '대기',
  processing: '처리 중',
  awaiting_matching: '매칭 대기',
  failed: '실패',
  created: '예약 전',
  partially_reserved: '부분 예약',
  awaiting_plan: '계획 대기',
  none: '송장 없음',
  allocated: '번호 할당',
  awaiting_batch: '배치 대기',
  queued: '작업 대기',
  picking: '피킹 중',
  ready_to_pack: '포장 대기',
  packing: '포장 중',
  withdrawing: '빼는 중',
  short_pick_recovery: '결품 복구',
  CONSOLIDATION_PENDING: '합포장 재개 대기',
  awaiting_dispatch: '발송 처리 대기',
  drop_ship_pending: '직배 대기',
  shipped: '발송됨',
  in_transit: '배송 중',
  drop_ship_forwarded: '직배 전달',
  CANCEL_REPLAN_PENDING: '재계획 대기',
  open_shipment: '상자 남음',
  open_reservation: '예약 남음',
  DISPATCH_RECALL_PENDING: '회수 재처리 대기',
  recovery_required: '복구 필요',
  no_units: '상자 없음',
  fo_missing: 'FO 없음',
};
const REQUEST_STATUS: Record<string, string> = {
  requested: '요청',
  approved: '승인',
  collection_pending: '회수 대기',
  collected: '회수 완료',
  inspected: '검수 완료',
  refund_pending: '환불 대기',
};

export function stateLabel(state: string | null): string {
  if (!state) return '';
  const rx = /^(return|exchange):(.+)$/.exec(state);
  if (rx)
    return `${rx[1] === 'return' ? '반품' : '교환'} ${REQUEST_STATUS[rx[2]] ?? rx[2]}`;
  return STATE_LABELS[state] ?? state;
}

/** 카드의 빨간 줄 문구. 0 인 항목은 쓰지 않는다(작은 글씨 최소화). */
export function cardAlertText(stuck: number, gaveUp: number): string {
  const parts: string[] = [];
  if (stuck > 0) parts.push(`갇힘 ${stuck.toLocaleString('ko-KR')}`);
  if (gaveUp > 0) parts.push(`자동 멈춤 ${gaveUp.toLocaleString('ko-KR')}`);
  return parts.join(' · ');
}

/** 목록 행의 «자동 멈춤» 배지 — 리컨실러가 다섯 번 시도하고 멈춘 주문(스펙 2026-10-08 §6). title 은 마지막 오류. */
export function gaveUpBadge(
  marks: GaveUpMark[] | undefined
): { text: string; title: string } | null {
  if (!marks || marks.length === 0) return null;
  return {
    text: `자동 멈춤 · ${marks.map((m) => `#${m.row}`).join(' ')}`,
    title: marks
      .filter((m) => m.lastError)
      .map((m) => `#${m.row} ${m.lastError}`)
      .join('\n'),
  };
}
