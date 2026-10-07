// src/lib/api/domains/orders/cancel-request.shape.ts
//
// 채널 주문 취소 요청(#1016 35번) 응답 정형·문구 순수 함수. admin-web 은 컴포넌트 테스트가 안 되므로 화면이 읽는 판정은 여기서 한다.
// 서버 원형: apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.types.ts (CancelRequestView)

import type { AmendmentRecord } from './sales-order-amendments.shape';

export interface CancelRequestView {
  id: string;
  status: 'requested' | 'applied' | 'rejected' | 'superseded';
  scope: 'full' | 'partial';
  stage: 'edited' | null;
  convertedFromFull: boolean;
  requestedAt: string;
  rejection: { reasonCode: string; message: string; at: string } | null;
  outcome: { refundAmount: number; shippingCharge: number; shippingRefund: number; shippingNotAdjusted: boolean } | null;
}

export type AdminCancelResponse =
  | { status: string; refundStatus: string; refundAmount?: number; manualReason?: string | null }
  | { requestId: string; status: string; scope: 'full' | 'partial'; convertedFromFull: boolean };

export type CancelAction =
  | { kind: 'cancel'; label: '취소' | '강제취소' }
  | { kind: 'requested'; label: string }
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
};
const won = new Intl.NumberFormat('ko-KR');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStatus(value: unknown): value is CancelRequestView['status'] {
  return value === 'requested' || value === 'applied' || value === 'rejected' || value === 'superseded';
}

function isScope(value: unknown): value is CancelRequestView['scope'] {
  return value === 'full' || value === 'partial';
}

function rejectionOf(value: unknown): CancelRequestView['rejection'] {
  return isRecord(value) && typeof value.reasonCode === 'string' && typeof value.message === 'string'
    ? { reasonCode: value.reasonCode, message: value.message, at: typeof value.at === 'string' ? value.at : '' }
    : null;
}

function outcomeOf(value: unknown): CancelRequestView['outcome'] {
  if (!isRecord(value)) return null;
  const { refundAmount, shippingCharge, shippingRefund } = value;
  if (typeof refundAmount !== 'number' || typeof shippingCharge !== 'number' || typeof shippingRefund !== 'number') return null;
  return { refundAmount, shippingCharge, shippingRefund, shippingNotAdjusted: value.shippingNotAdjusted === true };
}

export function toCancelRequestView(value: unknown): CancelRequestView | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null;
  const { status, scope } = value;
  if (!isStatus(status) || !isScope(scope)) return null;
  return {
    id: value.id,
    status,
    scope,
    stage: value.stage === 'edited' ? 'edited' : null,
    convertedFromFull: value.convertedFromFull === true,
    requestedAt: typeof value.requestedAt === 'string' ? value.requestedAt : '',
    rejection: rejectionOf(value.rejection),
    outcome: outcomeOf(value.outcome),
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
    stage: request.stage,
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
  if (request?.status === 'requested') {
    return { kind: 'requested', label: request.stage === 'edited' ? '수정됨 · 환불 미완' : '취소 요청됨' };
  }
  if (request?.status === 'rejected' && request.rejection) {
    return { kind: 'rejected', reason: `${REJECTION_LABELS[request.rejection.reasonCode] ?? request.rejection.reasonCode} · ${request.rejection.message}` };
  }
  return { kind: 'cancel', label: row.orderStatus === 'processing' ? '강제취소' : '취소' };
}

export function cancelRequestLine(view: CancelRequestView): string {
  const name = view.scope === 'full' ? '전체취소' : view.convertedFromFull ? '부분취소(출고분 제외)' : '부분취소';
  switch (view.status) {
    case 'requested':
      return `${name} 요청 · ${view.stage === 'edited' ? '수정됨 · 환불 미완' : '처리 중'}`;
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
      return [`${name} 반영`, `환불 ${won.format(o.refundAmount)}원`, shipping].filter(Boolean).join(' · ');
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

/** 상세 목록에 처리 중인 요청이 하나라도 있으면 true — 행을 잠깐 다시 읽어 «취소 요청됨»이 끝나는 걸 보인다. */
export function hasOpenCancelRequest(details: ReadonlyArray<unknown>): boolean {
  return details.some((d) => isRecord(d) && toCancelRequestView(d.cancelRequest)?.status === 'requested');
}
