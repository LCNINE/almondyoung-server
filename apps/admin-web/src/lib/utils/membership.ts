// 멤버십 도메인 표시 유틸. 날짜 포맷은 @/lib/utils/date 를 쓴다.

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

/** 만료일 기준 남은 구독 일수 라벨 */
export function getRemainingDays(endsAt: string | null): string {
  if (!endsAt) return '-';
  const end = new Date(endsAt);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.ceil(
    (end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diff < 0) return '만료됨';
  if (diff === 0) return '오늘 만료';
  return `${diff}일 남음`;
}

/** 최초 계약일로부터 경과한 멤버십 이용일 */
export function getMembershipUsageDays(firstContractCreatedAt: string): string {
  const start = new Date(firstContractCreatedAt);
  const today = new Date();
  const diff = Math.floor(
    (today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
  );
  return `${diff}일`;
}

/** 멤버십 계약 상태 → 라벨 + Badge variant */
export function getMembershipStatus(status: string | undefined): {
  label: string;
  variant: BadgeVariant;
} {
  switch (status) {
    case 'ACTIVE':
      return { label: '활성화', variant: 'default' };
    case 'PAUSED':
      return { label: '일시정지', variant: 'secondary' };
    case 'CANCELLED':
      return { label: '해지', variant: 'destructive' };
    case 'EXPIRED':
      return { label: '만료', variant: 'outline' };
    default:
      return { label: status ?? '-', variant: 'outline' };
  }
}

/** 결제 이벤트 타입 → 라벨 + Badge variant */
export function getBillingEventLabel(eventType: string): {
  label: string;
  variant: BadgeVariant;
} {
  switch (eventType) {
    case 'CHARGE_SUCCESS':
      return { label: '결제 성공', variant: 'default' };
    case 'CHARGE_FAIL':
      return { label: '결제 실패', variant: 'destructive' };
    case 'CHARGE_ATTEMPT':
      return { label: '결제 시도', variant: 'secondary' };
    default:
      return { label: eventType, variant: 'outline' };
  }
}
