import {
  REFUND_FAILURE_KINDS,
  type ChannelOrderCancelRefundFailure,
  type RefundFailureKind,
} from '@packages/event-contracts/streams';

/**
 * Medusa almond-payment 가 wallet 의 영구 환불 거절에 다는 표지(#1016 36번 스펙 §4.3).
 * 짝: apps/medusa/src/modules/almond-payment/wallet-refund-refusal.ts — 공유 패키지로 묶지 않는다
 * (`@packages` 별칭이 medusa 런타임에서 풀리지 않는다). 양쪽 스펙이 같은 예시 값을 써서 어긋남을 잡는다.
 */
const REFUND_FAILURE_CODE = /^wallet_refund_([a-z_]+):(.+)$/;

function isKind(value: unknown): value is RefundFailureKind {
  return REFUND_FAILURE_KINDS.some((kind) => kind === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 전체취소 400 응답의 `code`. 갈래를 모르는 표지는 null — 호출자가 일반 거절로 닫는다(재시도 루프를 만들지 않는다) */
export function parseRefundFailureCode(code: unknown): ChannelOrderCancelRefundFailure | null {
  if (typeof code !== 'string') return null;
  const match = REFUND_FAILURE_CODE.exec(code);
  if (!match) return null;
  const [, kind, walletCode] = match;
  return isKind(kind) ? { kind, walletCode } : null;
}

/** 부분취소 502 `refund_pending` 본문의 `refundFailure` 객체 */
export function readRefundFailure(value: unknown): ChannelOrderCancelRefundFailure | null {
  if (!isRecord(value)) return null;
  const { kind, walletCode } = value;
  return isKind(kind) && typeof walletCode === 'string' && walletCode.length > 0 ? { kind, walletCode } : null;
}
