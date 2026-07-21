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
