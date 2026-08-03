// apps/notification/src/shared/utils/template-helpers.ts
export const templateHelpers = {
  formatPhoneNumber: (phone: string): string => {
    // Format Korean phone number
    return phone.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
  },

  truncate: (text: string, length: number): string => {
    if (text.length <= length) return text;
    return text.substring(0, length) + '...';
  },

  capitalize: (text: string): string => {
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
  },

  formatOrderNumber: (orderId: string): string => {
    return `ORD-${orderId.toUpperCase()}`;
  },
};

export const formatAmount = (value: unknown): string => {
  const n = typeof value === 'string' ? Number(value.replace(/,/g, '')) : Number(value);
  return Number.isFinite(n) ? n.toLocaleString('ko-KR') : String(value ?? '-');
};

/**
 * 주문 금액 안내 문구. 포인트는 할인이 아니라 결제수단이라 총액에 그대로 포함돼 있어,
 * 총액만 적으면 포인트로 결제한 고객이 그 금액을 현금으로 낸 것으로 읽는다.
 *
 * 템플릿이 '{{total}}원' 으로 단위를 붙이므로 반환값은 반드시 숫자로 끝나야 한다
 * (템플릿 렌더러는 단순 치환이라 조건 분기를 템플릿 쪽에 둘 수 없다).
 */
export const formatOrderTotal = (totalAmount: unknown, pointsAmount?: unknown): string => {
  const total = Number(totalAmount);
  const points = Number(pointsAmount);
  if (!Number.isFinite(total) || !Number.isFinite(points) || points <= 0) {
    return formatAmount(totalAmount);
  }
  return `${formatAmount(total)}원 · 포인트 ${formatAmount(points)}원 사용 · 실결제 ${formatAmount(total - points)}`;
};

export const formatDueDate = (value: unknown): string => {
  if (typeof value !== 'string') return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  // 한국 영업 기준 알림이라 KST 고정. 다국어/다지역 발송이 생기면 locale 을 인자로 받을 것.
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('month')} ${get('day')}일(${get('weekday')}) ${get('hour')}:${get('minute')}`;
};
