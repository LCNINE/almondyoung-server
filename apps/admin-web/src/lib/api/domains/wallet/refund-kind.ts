// wallet 환불 종류(#1016 40번). 정본은 apps/wallet/src/schema.ts 의 refundKindEnum —
// admin-web 은 wallet 을 import 할 수 없어 사본을 둔다. 값을 바꾸면 거기와 함께 고칠 것 — `apps/wallet/src/refunds/refund-kind-copies.spec.ts` 가 지킨다.
export const REFUND_KINDS = ['ITEM_CANCEL', 'RETURN', 'PRICE_ADJUSTMENT', 'SUBSCRIPTION_FEE', 'PAYMENT_ERROR'] as const;

export type RefundKind = (typeof REFUND_KINDS)[number];

const LABELS: Record<RefundKind, string> = {
  ITEM_CANCEL: '품목 취소',
  RETURN: '반품',
  PRICE_ADJUSTMENT: '금액 조정',
  SUBSCRIPTION_FEE: '구독료 환불',
  PAYMENT_ERROR: '결제 오류',
};

const UNKNOWN_LABEL = '모름';

/** null·모르는 문자열은 «모름» (옛 행) */
export function refundKindLabel(kind: unknown): string {
  return typeof kind === 'string' && kind in LABELS ? LABELS[kind as RefundKind] : UNKNOWN_LABEL;
}

export const REFUND_KIND_FILTER_OPTIONS: { label: string; value: RefundKind | 'UNKNOWN' }[] = [
  ...REFUND_KINDS.map((value) => ({ label: LABELS[value], value })),
  { label: UNKNOWN_LABEL, value: 'UNKNOWN' },
];

export function refundFormError(input: { kind: RefundKind | ''; amount: number | '' }): string | null {
  if (!input.kind) return '환불 종류를 골라 주세요';
  if (input.amount === '' || input.amount < 1) return '환불 금액을 입력해 주세요';
  return null;
}

/** 상태 이력 한 줄. 종류 고치기 행이면 문구, 아니면 null(기존 «이전 → 이후» 표시) */
export function stateTransitionLabel(t: {
  reasonCode?: string | null;
  payload?: Record<string, unknown> | null;
}): string | null {
  if (t.reasonCode !== 'KIND_CHANGED') return null;
  return `종류 변경: ${refundKindLabel(t.payload?.fromKind)} → ${refundKindLabel(t.payload?.toKind)}`;
}
