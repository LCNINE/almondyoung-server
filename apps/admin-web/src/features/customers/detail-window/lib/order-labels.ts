import type { AdminOrder } from '@/lib/api/domains/medusa';

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  not_paid: '미결제',
  awaiting: '입금대기',
  authorized: '결제승인',
  partially_authorized: '부분승인',
  captured: '결제완료',
  partially_captured: '부분결제',
  partially_refunded: '부분환불',
  refunded: '환불완료',
  canceled: '결제취소',
  requires_action: '조치필요',
};

export const FULFILLMENT_STATUS_LABELS: Record<string, string> = {
  not_fulfilled: '미배송',
  partially_fulfilled: '부분처리',
  fulfilled: '배송준비',
  partially_shipped: '부분출고',
  shipped: '출고완료',
  partially_delivered: '부분배송',
  delivered: '배송완료',
  canceled: '배송취소',
};

export function paymentStatusLabel(status: string): string {
  return PAYMENT_STATUS_LABELS[status] ?? status;
}

export function fulfillmentStatusLabel(status: string): string {
  return FULFILLMENT_STATUS_LABELS[status] ?? status;
}

// 필터 드롭다운용 옵션 목록
export const PAYMENT_STATUS_OPTIONS = Object.entries(PAYMENT_STATUS_LABELS).map(
  ([value, label]) => ({ value, label })
);

export const FULFILLMENT_STATUS_OPTIONS = Object.entries(
  FULFILLMENT_STATUS_LABELS
).map(([value, label]) => ({ value, label }));

/** 결제 provider_id → 사람이 읽는 결제수단 라벨 (best-effort 매핑) */
export function paymentMethodLabel(providerId: string): string {
  const id = providerId.toLowerCase();
  if (id.includes('toss') || id.includes('card') || id.includes('pg')) {
    return '신용카드';
  }
  if (
    id.includes('point') ||
    id.includes('reward') ||
    id.includes('credit') ||
    id.includes('wallet')
  ) {
    return '적립금';
  }
  if (id.includes('manual') || id.includes('system')) return '수기결제';
  return providerId.replace(/^pp_/, '');
}

// 멤버십 역할 여부로 등급 라벨 추정 (정식 등급 체계 들어오면 교체)
export function membershipLabel(roles: string[] | undefined): string {
  if (roles?.includes('membership')) return '멤버십 회원';
  return '일반 회원';
}

/** 통화 코드에 맞춰 금액 문자열로 변환 (KRW 는 ₩, 그 외는 코드 병기) */
export function formatCurrency(
  amount: number | null | undefined,
  currencyCode: string | null | undefined
): string {
  const code = (currencyCode ?? '').toUpperCase();
  const value = Number(amount ?? 0).toLocaleString();
  if (code === 'KRW' || !code) return `₩${value}`;
  return `${value} ${code}`;
}

export function formatOrderAmount(order: AdminOrder): string {
  return formatCurrency(order.total, order.currency_code);
}
