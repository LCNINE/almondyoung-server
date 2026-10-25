// src/lib/api/domains/orders/order-progress.shape.ts
//
// 정체 보드 응답 정형·표기 순수 함수. admin-web 은 컴포넌트 테스트가 안 되므로 화면이 읽는 판정은 전부 여기서 한다.
// 서버 원형: apps/core/src/modules/fulfillment/order-progress/order-progress.controller.ts

import { formatDwell } from '../../../utils/format-dwell';
import { toSettlementView } from './cancel-request.shape';
import type { SettlementView } from './cancel-request.shape';

// cancel-request.shape 와 순환하지 않게 formatDwell 은 utils 로 뺐다. 기존 호출부를 위해 다시 내보낸다.
export { formatDwell };

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
  /** 정산 중 요청의 정산 정보(#1016 36번 재설계). 옛 core 응답엔 없다 → null */
  settlement: SettlementView | null;
  walletIntentId: string | null;
  /** 예약 단계의 부족 품목·입고 예정(#1016 15번). 옛 core 응답엔 없다 → null */
  shortage: ReserveShortageView | null;
}
export interface ReserveShortageItemView {
  skuId: string;
  skuName: string;
  shortQty: number;
  /** YYYY-MM-DD. Date 로 바꾸지 않는다 — 시간대가 하루를 옮긴다 */
  expectedArrival: string | null;
}
export interface ReserveShortageView {
  shipmentId: string;
  manifestVersion: number;
  consolidated: boolean;
  /** 대표 상자에 확정 예약이 있다 — 없으면(전부 미예약) 나눠도 409 라 버튼을 내지 않는다. 옛 core 응답엔 없다 → false */
  splittable: boolean;
  skuKinds: number;
  shortSkuKinds: number;
  items: ReserveShortageItemView[];
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

function toShortageItem(value: unknown): ReserveShortageItemView | null {
  if (!isRecord(value)) return null;
  const { skuId, skuName, shortQty, expectedArrival } = value;
  if (typeof skuId !== 'string' || typeof skuName !== 'string') return null;
  if (typeof shortQty !== 'number' || !Number.isFinite(shortQty)) return null;
  if (expectedArrival !== null && typeof expectedArrival !== 'string') return null;
  return { skuId, skuName, shortQty, expectedArrival };
}

/** 형식이 하나라도 틀리면 null — 옛 core 응답이거나 계약이 바뀐 것이니 부분만 그리지 않는다. */
export function toShortageView(value: unknown): ReserveShortageView | null {
  if (!isRecord(value)) return null;
  const { shipmentId, manifestVersion, consolidated, skuKinds, shortSkuKinds, items } = value;
  if (typeof shipmentId !== 'string' || typeof consolidated !== 'boolean') return null;
  if (typeof manifestVersion !== 'number' || typeof skuKinds !== 'number' || typeof shortSkuKinds !== 'number') return null;
  if (!Array.isArray(items) || items.length === 0) return null;
  const parsed = items.map(toShortageItem);
  if (parsed.some((i) => i === null)) return null;
  return {
    shipmentId,
    manifestVersion,
    consolidated,
    splittable: value.splittable === true,
    skuKinds,
    shortSkuKinds,
    items: parsed as ReserveShortageItemView[],
  };
}

export function toProgressPage(body: unknown): ProgressPage {
  const v = unwrap(body);
  if (!isRecord(v) || !Array.isArray(v.items))
    return { items: [], nextCursor: null };
  return {
    items: v.items.map((item) => {
      const row = item as ProgressItem & { settlement?: unknown; walletIntentId?: unknown; shortage?: unknown };
      return {
        ...row,
        settlement: toSettlementView(row.settlement),
        walletIntentId: typeof row.walletIntentId === 'string' ? row.walletIntentId : null,
        shortage: toShortageView(row.shortage),
      };
    }),
    nextCursor: typeof v.nextCursor === 'string' ? v.nextCursor : null,
  };
}

const MIN = 60_000;

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
  settle_in_progress: '환불 처리 중',
  settle_delayed: '환불 지연',
  settle_refused: '환불 거절',
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
  drop_ship_unfulfillable: '직배 못 보냄',
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

/** 메인·통계·주문내역의 «출고 불가» 카드가 가는 곳 — 카드 숫자와 보드 예약 칸이 같은 집합이다. */
export const STALL_BOARD_RESERVE_HREF = '/order/stall-board?stage=reserve';

/** `?stage=` 로 들어온 값을 시작 단계로. 보드에 없는 값이면 기본(FO 생성). */
export function initialBoardStage(param: string | null): BoardStageKey {
  const hit = BOARD_STAGES.find((s) => s.key === param);
  return hit ? hit.key : 'fo';
}

/** «10종 중 1종 · 헤어클립 세트 2개». 품목이 셋 이상이면 «… 외 N». */
export function shortageSummary(s: ReserveShortageView): string {
  const line = (i: ReserveShortageItemView) => `${i.skuName} ${i.shortQty.toLocaleString('ko-KR')}개`;
  const items =
    s.items.length <= 2
      ? s.items.map(line).join(', ')
      : `${line(s.items[0])} 외 ${s.items.length - 1}`;
  return `${s.skuKinds}종 중 ${s.shortSkuKinds}종 · ${items}`;
}

/** «입고 10-25». 입고 예정이 없으면 빈 문자열(작은 글씨 최소화). 날짜 문자열을 쪼개 쓴다 — Date 는 시간대로 하루가 밀린다. */
export function arrivalLabel(expectedArrival: string | null): string {
  const m = expectedArrival ? /^\d{4}-(\d{2}-\d{2})$/.exec(expectedArrival) : null;
  return m ? `입고 ${m[1]}` : '';
}

/**
 * 합포장 상자는 다른 주문의 라인이 섞여 있어 여기서 나누지 않고, 예약된 몫이 하나도 없으면 나눌 게 없다(서버가
 * SHIPMENT_NOTHING_RESERVED 409). 나머지 거절(다 예약됨 등)은 서버가 한다.
 */
export function canSplitShortage(s: ReserveShortageView): boolean {
  return !s.consolidated && s.splittable;
}

/** 예약 줄 오른쪽에 무엇을 낼지 — 버튼, 합포장 안내, 아니면 입고를 기다리는 중(나눌 몫이 없음). */
export function shortageActionKind(s: ReserveShortageView): 'split' | 'consolidated' | 'waiting' {
  if (s.consolidated) return 'consolidated';
  return s.splittable ? 'split' : 'waiting';
}

export const SHORTAGE_WAITING_LABEL = '입고 대기';
export const SHORTAGE_CONSOLIDATED_LABEL = '합포장 — FO 상세에서';

export const SPLIT_QTY_ERROR =
  '분할 수량은 1 이상, 라인 수량 이하여야 하고 상자에 수량이 남아야 합니다';

/** FO 상세 분할 검사. 라인 전부를 옮겨도 상자에 다른 수량이 남으면 된다(상자가 비는 것만 막는다). */
export function isSplitQtyAllowed(
  moveQty: number,
  lineQty: number,
  shipmentTotalQty: number
): boolean {
  return (
    Number.isInteger(moveQty) &&
    moveQty >= 1 &&
    moveQty <= lineQty &&
    moveQty < shipmentTotalQty
  );
}

/** split-unreserved 409 코드별 토스트 문구. 모르는 코드(낡은 manifest 버전 등)는 서버 문구를 그대로. */
export function splitUnreservedErrorText(code: string | null, serverMessage: string): string {
  switch (code) {
    case 'SHIPMENT_FULLY_RESERVED':
      return '이미 다 예약됨';
    case 'SHIPMENT_NOTHING_RESERVED':
      return '예약된 수량이 없어 나눌 수 없음';
    case 'SHIPMENT_CONSOLIDATED':
      return '합포장 상자는 FO 상세에서 나눠야 함';
    case 'SHIPMENT_NOT_DRAFT':
      return '이미 계획이 진행된 상자';
    default:
      return serverMessage;
  }
}
