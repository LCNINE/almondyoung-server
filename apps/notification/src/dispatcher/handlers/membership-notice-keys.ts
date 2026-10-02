/**
 * 멤버십 요금 안내 알림의 멱등 키. 컨슈머가 발송할 때와 관리자 화면이 «이 안내가 나갔나»를 물을 때
 * 같은 함수로 만든다 — 키 형식은 이 서비스만 알고, 묻는 쪽은 인보이스·계약 id 만 넘긴다.
 */
export const billingFailedNoticeKey = (invoiceId: string, attemptCount: number): string =>
  `membership:billing-failed:${invoiceId}:${attemptCount}`;

export const terminatedNoticeKey = (contractId: string): string => `membership:terminated-notice:${contractId}`;
