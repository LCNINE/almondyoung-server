// src/lib/api/domains/orders/cancel-request.shape.ts
//
// 채널 주문 취소 요청(#1016 35번 · 36번 재설계: 요청은 확정이다) 응답 정형·문구 순수 함수. admin-web 은 컴포넌트 테스트가 안 되므로 화면이 읽는 판정은 여기서 한다.
// 서버 원형: apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.types.ts (CancelRequestView)

import { formatDwell } from '../../../utils/format-dwell';
import type { AmendmentRecord } from './sales-order-amendments.shape';

export type SettlementPhase = 'in_progress' | 'delayed' | 'refused';
export interface SettlementView {
  requestId: string;
  phase: SettlementPhase;
  mode: 'auto' | 'manual';
  confirmedAt: string;
  /** 이번 정산 시도의 시작 — [다시 시도]·[계좌 송금]마다 새로 찍힌다. 옛 core 응답엔 없다 */
  startedAt?: string;
  deadlineAt: string;
  lastFailure: { code: string; message: string; retryable: boolean; at: string } | null;
}

export interface CancelRequestView {
  id: string;
  status: 'settling' | 'applied' | 'rejected' | 'superseded';
  scope: 'full' | 'partial';
  convertedFromFull: boolean;
  requestedAt: string;
  rejection: { reasonCode: string; message: string; at: string; unresolvedRefundAmount?: number } | null;
  outcome: {
    refundAmount: number;
    shippingCharge: number;
    shippingRefund: number;
    shippingNotAdjusted: boolean;
    externalRefundApplied?: number;
  } | null;
  /** 확정 뒤 정산 중일 때만(core 가 settling 에만 싣는다). 옛 응답은 null */
  settlement: SettlementView | null;
  refundMode: 'auto' | 'manual' | null;
}

export type AdminCancelResponse =
  | { status: string; refundStatus: string; refundAmount?: number; manualReason?: string | null }
  | { requestId: string; status: string; scope: 'full' | 'partial'; convertedFromFull: boolean };

export type CancelAction =
  | { kind: 'cancel'; label: '취소' | '강제취소' }
  | { kind: 'settling'; label: string; alert: boolean }
  | { kind: 'rejected'; reason: string }
  | { kind: 'seller_center'; label: string };

const CHANNEL_CANCEL_REQUEST_REASON = 'CHANNEL_CANCEL_REQUEST';
const SELLER_CENTER: Record<string, string> = { naver: '네이버', coupang: '쿠팡' };
const REJECTION_LABELS: Record<string, string> = {
  NOT_SUPPORTED: '자동 취소 불가 채널',
  ORDER_NOT_FOUND: '채널에 주문 없음',
  NOT_CANCELABLE: '채널이 거절',
  REFUND_FAILED: '환불 불가',
  OPERATOR_WITHDRAWN: '요청 접음',
  EXTERNAL_REFUND_UNRESOLVED: '이미 환불한 금액 확인 필요',
};
const won = new Intl.NumberFormat('ko-KR');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStatus(value: unknown): value is CancelRequestView['status'] {
  // 'requested' 는 옛 흐름의 역사 값 — 뷰로 만들지 않는다(그 주문은 «취소» 버튼으로 새 흐름을 탄다, PR 6)
  return value === 'settling' || value === 'applied' || value === 'rejected' || value === 'superseded';
}

function isScope(value: unknown): value is CancelRequestView['scope'] {
  return value === 'full' || value === 'partial';
}

export const SETTLEMENT_LABELS: Record<SettlementPhase, string> = {
  in_progress: '환불 처리 중',
  delayed: '환불 지연',
  refused: '환불 거절',
};
export const MANUAL_REFUND_CONFIRM_TEXT =
  '고객에게 계좌를 받아 직접 송금한 뒤, 결제 관리 › 환불 내역에서 [완료 처리]를 눌러 주세요.';
const WALLET_REFUSED_PREFIX = 'wallet_refund_refused:';
/** 채널(Medusa)이 «이미 환불한 금액»을 물으며 거절한 부분취소(#1016 37번) — core 가 이 실패일 때만 금액을 받는다 */
const EXTERNAL_REFUND_PREFIX = 'external_refund_';
/**
 * 정산의 칩·줄 이름. 거절 중 채널이 «이미 환불한 금액»을 물은 것(#1016 37번, external_refund_*)은 운영자가 할 일이 다르다 —
 * 계좌 송금이 아니라 [다시 시도]에 금액을 넣는다. 그래서 «환불 거절» 대신 그 말로 부른다(36번 스모크 발견 ③).
 */
export function settlementLabel(s: SettlementView): string {
  if (s.phase === 'refused' && s.lastFailure?.code.startsWith(EXTERNAL_REFUND_PREFIX)) {
    return REJECTION_LABELS.EXTERNAL_REFUND_UNRESOLVED;
  }
  return SETTLEMENT_LABELS[s.phase];
}
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const KST_OFFSET_MS = 9 * 3_600_000;

function isPhase(value: unknown): value is SettlementPhase {
  return value === 'in_progress' || value === 'delayed' || value === 'refused';
}

function failureOf(value: unknown): SettlementView['lastFailure'] {
  if (!isRecord(value) || typeof value.code !== 'string' || typeof value.message !== 'string') return null;
  return {
    code: value.code,
    message: value.message,
    retryable: value.retryable === true,
    at: typeof value.at === 'string' ? value.at : '',
  };
}

export function toSettlementView(value: unknown): SettlementView | null {
  if (!isRecord(value) || typeof value.requestId !== 'string' || !isPhase(value.phase)) return null;
  if (value.mode !== 'auto' && value.mode !== 'manual') return null;
  if (typeof value.confirmedAt !== 'string' || typeof value.deadlineAt !== 'string') return null;
  return {
    requestId: value.requestId,
    phase: value.phase,
    mode: value.mode,
    confirmedAt: value.confirmedAt,
    ...(typeof value.startedAt === 'string' ? { startedAt: value.startedAt } : {}),
    deadlineAt: value.deadlineAt,
    lastFailure: failureOf(value.lastFailure),
  };
}

/** 운영자가 읽는 사유. wallet·PG 영구 거절과 그 밖(주문 없음 등 «개발 확인»)을 failureCode 접두사로 가른다(PR 3 넘길 것 4) */
export function settlementReason(s: SettlementView): string | null {
  const f = s.lastFailure;
  // 환불 처리 중에 지난 실패를 곁에 두면 모순으로 읽힌다 — 다시 시도한 뒤의 진행 중엔 사유를 숨긴다
  if (!f || s.phase === 'in_progress') return null;
  if (f.code.startsWith(WALLET_REFUSED_PREFIX)) return `환불 거절 · ${f.message || f.code}`;
  if (f.code.startsWith(EXTERNAL_REFUND_PREFIX)) return `${REJECTION_LABELS.EXTERNAL_REFUND_UNRESOLVED} · ${f.message || f.code}`;
  return `정산 실패 · 개발 확인 · ${f.message || f.code}`;
}

/**
 * 상세 목록에 «결과를 기다리는» 정산이 있으면 true — 행을 잠깐 다시 읽어 거절·완료를 곧바로 보인다(#1016 36번).
 * 취소·조치 응답은 정산 시작만 알리고, 결과(거절·완료·일시 실패)는 몇 초 뒤 Medusa → channel-adapter → 사실로 따로 온다.
 * 시작(startedAt, 옛 core 는 확정 시각) 뒤 2분까지만 센다 — 막힌 정산을 계속 읽지 않게, 그건 리컨실러·정체 보드의 몫이다.
 */
export function awaitsSettlementResult(details: ReadonlyArray<unknown>, now: number, windowMs = 120_000): boolean {
  return details.some((d) => {
    const view = isRecord(d) ? toCancelRequestView(d.cancelRequest) : null;
    const s = view?.status === 'settling' ? view.settlement : null;
    if (!s || s.phase === 'refused') return false;
    const start = Date.parse(s.startedAt ?? s.confirmedAt);
    if (!Number.isFinite(start) || now - start > windowMs) return false;
    // 시작 뒤에 온 실패 사실이 곧 «결과»다. 지난 시도의 실패는 아니다
    return !(s.lastFailure && Date.parse(s.lastFailure.at) >= start);
  });
}

/** 서버(core restartSettlement)와 같은 규칙 — 정산 중(30분 안)엔 조치 없음(D8), 이미 계좌 송금이면 다시 시도만 */
export function settlementActionsOf(s: SettlementView | null): { retry: boolean; manualRefund: boolean } {
  if (!s || s.phase === 'in_progress') return { retry: false, manualRefund: false };
  return { retry: true, manualRefund: s.mode !== 'manual' };
}

export function settlementTiming(s: SettlementView, now: number): string {
  const deadline = new Date(Date.parse(s.deadlineAt) + KST_OFFSET_MS);
  const day = `${deadline.getUTCMonth() + 1}/${deadline.getUTCDate()}(${WEEKDAYS[deadline.getUTCDay()]})`;
  return `확정 후 ${formatDwell(now - Date.parse(s.confirmedAt))} · 기한 ${day}`;
}

/** 운영자 취소는 요청 순간 확정된다(#1016 36번 재설계) — 응답이 곧 «취소했다»다 */
export function cancelRequestToast(r: Extract<AdminCancelResponse, { requestId: string }>): string {
  return r.convertedFromFull
    ? '출고된 상품을 뺀 나머지를 취소했습니다. 환불은 채널이 처리합니다.'
    : '취소했습니다. 환불은 채널이 처리합니다.';
}

function rejectionOf(value: unknown): CancelRequestView['rejection'] {
  if (!isRecord(value) || typeof value.reasonCode !== 'string' || typeof value.message !== 'string') return null;
  return {
    reasonCode: value.reasonCode,
    message: value.message,
    at: typeof value.at === 'string' ? value.at : '',
    ...(typeof value.unresolvedRefundAmount === 'number' ? { unresolvedRefundAmount: value.unresolvedRefundAmount } : {}),
  };
}

function outcomeOf(value: unknown): CancelRequestView['outcome'] {
  if (!isRecord(value)) return null;
  const { refundAmount, shippingCharge, shippingRefund } = value;
  if (typeof refundAmount !== 'number' || typeof shippingCharge !== 'number' || typeof shippingRefund !== 'number') return null;
  return {
    refundAmount,
    shippingCharge,
    shippingRefund,
    shippingNotAdjusted: value.shippingNotAdjusted === true,
    ...(typeof value.externalRefundApplied === 'number' ? { externalRefundApplied: value.externalRefundApplied } : {}),
  };
}

export function toCancelRequestView(value: unknown): CancelRequestView | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null;
  const { status, scope } = value;
  if (!isStatus(status) || !isScope(scope)) return null;
  return {
    id: value.id,
    status,
    scope,
    convertedFromFull: value.convertedFromFull === true,
    requestedAt: typeof value.requestedAt === 'string' ? value.requestedAt : '',
    rejection: rejectionOf(value.rejection),
    outcome: outcomeOf(value.outcome),
    settlement: toSettlementView(value.settlement),
    refundMode: value.refundMode === 'auto' || value.refundMode === 'manual' ? value.refundMode : null,
  };
}

/** 변경 기록 행(`GET /sales-orders/:id/amendments`)에서 같은 뷰를 만든다. 취소 요청 행이 아니면 null. */
export function cancelRequestFromAmendment(row: AmendmentRecord): CancelRequestView | null {
  if (row.reasonCode !== CHANNEL_CANCEL_REQUEST_REASON || !isRecord(row.metadata)) return null;
  const request = row.metadata.request;
  if (!isRecord(request)) return null;
  return toCancelRequestView({
    id: row.id,
    status: row.status,
    scope: request.scope,
    convertedFromFull: request.convertedFromFull,
    requestedAt: row.occurredAt,
    rejection: row.metadata.rejection,
    outcome: row.metadata.outcome,
  });
}

export function cancelActionOf(row: { channel: string; orderStatus: string; cancelRequest: CancelRequestView | null }): CancelAction {
  const center = SELLER_CENTER[row.channel];
  if (center) return { kind: 'seller_center', label: `${center} 판매자센터에서 취소` };
  const request = row.cancelRequest;
  if (request?.status === 'settling') {
    const phase = request.settlement?.phase ?? 'in_progress';
    const label = request.settlement ? settlementLabel(request.settlement) : SETTLEMENT_LABELS.in_progress;
    return { kind: 'settling', label, alert: phase !== 'in_progress' };
  }
  if (request?.status === 'rejected' && request.rejection) {
    return { kind: 'rejected', reason: `${REJECTION_LABELS[request.rejection.reasonCode] ?? request.rejection.reasonCode} · ${request.rejection.message}` };
  }
  return { kind: 'cancel', label: row.orderStatus === 'processing' ? '강제취소' : '취소' };
}

export function cancelRequestLine(view: CancelRequestView): string {
  const name = view.scope === 'full' ? '전체취소' : view.convertedFromFull ? '부분취소(출고분 제외)' : '부분취소';
  switch (view.status) {
    case 'settling':
      return view.settlement ? `${name} 확정 · ${settlementLabel(view.settlement)}` : `${name} 확정 · 정산 중`;
    case 'applied': {
      const o = view.outcome;
      if (!o) return `${name} 반영`;
      const shipping = o.shippingNotAdjusted
        ? '배송비 미조정'
        : o.shippingCharge > 0
          ? `배송비 −${won.format(o.shippingCharge)}원`
          : o.shippingRefund > 0
            ? `배송비 환불 ${won.format(o.shippingRefund)}원`
            : null;
      const offset = o.externalRefundApplied ? `외부 환불 ${won.format(o.externalRefundApplied)}원 상계` : null;
      return [`${name} 반영`, `환불 ${won.format(o.refundAmount)}원`, shipping, offset].filter(Boolean).join(' · ');
    }
    case 'rejected': {
      const r = view.rejection;
      return r ? `${name} 실패 · ${REJECTION_LABELS[r.reasonCode] ?? r.reasonCode} · ${r.message}` : `${name} 실패`;
    }
    case 'superseded':
      return `${name} 요청 · 다른 변경으로 대체됨`;
  }
}

export function isCancelRequested(r: AdminCancelResponse): r is Extract<AdminCancelResponse, { requestId: string }> {
  return 'requestId' in r && typeof r.requestId === 'string';
}

/**
 * 품목은 확정 때 이미 취소돼 새 요청을 낼 수 없다 — 채널이 «이미 환불한 금액»을 물었으면 [다시 시도]가 그 금액을 받는다(#1016 37번).
 * 물을 금액(품목에 연결 안 된 외부 환불)은 사유 문장에 있다.
 */
export function asksAlreadyRefunded(s: SettlementView | null): boolean {
  if (!s || s.phase === 'in_progress') return false;
  return s.lastFailure?.code.startsWith(EXTERNAL_REFUND_PREFIX) ?? false;
}

/** 이미 환불한 금액 입력 — 0 이상의 정수(원), 콤마 허용. 아니면 null */
export function parseAlreadyRefunded(text: string): number | null {
  const t = text.replace(/,/g, '').trim();
  if (!/^\d+$/.test(t)) return null;
  return Number(t);
}
