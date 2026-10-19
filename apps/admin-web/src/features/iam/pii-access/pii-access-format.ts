import type { PiiAccessAction, PiiAccessSubject } from '@/lib/types/dto/iam';

const SUBJECT_LABELS: Readonly<Record<string, string>> = {
  user: '회원',
  sales_order: '주문',
  sales_order_amendment: '주문 변경',
  shipment: '출고 상자',
  fulfillment_order: '출고 요청',
  fulfillment_operation: '출고 작업',
  return_request: '반품',
  exchange_request: '교환',
  cs_case: 'CS',
  payment_intent: '결제',
  refund_request: '환불 신청',
  membership_contract: '멤버십 계약',
  business_license: '사업자등록',
  notification: '알림',
  review: '리뷰',
  shop_listing: '샵매매',
  print_order: '출력 주문',
  channel_order: '채널 주문',
  event_record: '이벤트 기록',
  medusa_customer: '쇼핑몰 고객',
  medusa_order: '쇼핑몰 주문',
};

export const PII_ACTION_LABELS: Readonly<Record<PiiAccessAction, string>> = {
  view: '열람',
  reveal: '보기(원문)',
  export: '내려받기',
};

const SHOWN = 2;
const count = new Intl.NumberFormat('ko-KR');

/** 앞의 두 개 + «외 N건». 건수는 실제 건수(행에 담긴 식별자는 상한까지만). */
export function describeSubjects(subjects: readonly PiiAccessSubject[], subjectCount: number): string {
  if (subjects.length === 0) return '대상 식별자 없음';
  const head = subjects.slice(0, SHOWN).map((s) => `${SUBJECT_LABELS[s.type] ?? s.type} ${s.id}`);
  const rest = Math.max(subjectCount, subjects.length) - head.length;
  return rest > 0 ? `${head.join(', ')} 외 ${count.format(rest)}건` : head.join(', ');
}

const KST_HOUR = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hourCycle: 'h23' });

/** 한국 시각 09~19시 밖 — 점검 때 먼저 보는 행(서버 요약의 기준과 같다). */
export function isAfterHours(occurredAt: string): boolean {
  const hour = Number(KST_HOUR.format(new Date(occurredAt)));
  return hour < 9 || hour >= 19;
}

/** 그날이 속한 한국 달의 [1일 0시, 다음달 1일 0시). 한국은 서머타임이 없어 +09:00 고정. */
export function monthRange(day: string): { period: string; from: string; to: string } {
  const [year, month] = day.split('-').map(Number);
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    period: `${year}-${pad(month)}`,
    from: new Date(`${year}-${pad(month)}-01T00:00:00+09:00`).toISOString(),
    to: new Date(`${next.y}-${pad(next.m)}-01T00:00:00+09:00`).toISOString(),
  };
}
