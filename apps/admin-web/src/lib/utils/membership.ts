// 멤버십 도메인 표시 유틸. 날짜 포맷은 @/lib/utils/date 를 쓴다.

import { formatDate } from '@/lib/utils/date';
import type { ContractEventMetadata } from '@/lib/api/domains/membership';

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

/** 사유 칸에 자주 들어오는 무의미한 입력값. 그대로 보여주면 로그가 더 헷갈린다. */
const MEANINGLESS_REASONS = new Set(['.', '-', '..', '...', 'ㅁ', 'ㅇ', 'test', 'ㅋ']);

function cleanReason(reason: string | null | undefined): string | null {
  const trimmed = reason?.trim();
  if (!trimmed || MEANINGLESS_REASONS.has(trimmed.toLowerCase())) return null;
  return trimmed;
}

/** 작업 주체 코드 → 한국어. 관리자는 아이디를 따로 붙이므로 여기선 역할만 말한다. */
export function getCausedByLabel(causedBy: string): string {
  switch (causedBy) {
    case 'ADMIN':
      return '관리자';
    case 'SYSTEM':
      return '시스템(자동)';
    case 'USER':
      return '회원 본인';
    default:
      return causedBy;
  }
}

/**
 * 계약 이벤트 한 줄을 사람이 읽는 문장으로 바꾼다.
 * `GRANTED_BY_ADMIN` 같은 영문 상수만 찍으면 CS 담당자가 무슨 일이 있었는지 알 수 없다 —
 * 며칠을 줬는지, 언제까지 늘었는지, 왜 해지했는지는 전부 metadata 에 들어있다.
 */
export function describeContractEvent(
  eventType: string,
  metadata?: ContractEventMetadata
): { label: string; variant: BadgeVariant; detail: string | null } {
  const m = metadata ?? {};
  const reason = cleanReason(m.reason);
  const until = m.newEndsAt ? `${formatDate(m.newEndsAt)}까지` : null;
  const shift =
    m.previousEndsAt && m.newEndsAt
      ? `${formatDate(m.previousEndsAt)} → ${formatDate(m.newEndsAt)}`
      : until;
  const parts: (string | null)[] = [];

  switch (eventType) {
    case 'CREATED':
      parts.push(m.billingMode === 'one_time' ? '1회 결제' : '정기 결제', reason);
      return { label: '멤버십 가입', variant: 'default', detail: joinParts(parts) };

    case 'GRANTED_BY_ADMIN':
      parts.push(m.days ? `${m.days}일 지급` : null, until, reason);
      return { label: '관리자 지급', variant: 'default', detail: joinParts(parts) };

    case 'ENTITLEMENT_EXTENDED':
      parts.push(m.days ? `${m.days}일 연장` : null, shift, reason);
      return { label: '기간 연장', variant: 'secondary', detail: joinParts(parts) };

    case 'ENTITLEMENT_REDUCED':
      // days 가 음수로 들어온다 — 부호를 그대로 노출하면 "-6일 단축" 이라 이중부정으로 읽힌다.
      parts.push(m.days ? `${Math.abs(m.days)}일 단축` : null, shift, reason);
      return { label: '기간 단축', variant: 'destructive', detail: joinParts(parts) };

    case 'CANCELLED':
      parts.push(
        m.isForced ? '관리자 강제 해지' : null,
        m.refundAmount ? `환불 ${m.refundAmount.toLocaleString()}원` : '환불 없음',
        reason
      );
      return { label: '해지', variant: 'destructive', detail: joinParts(parts) };

    case 'REFUND_REQUESTED':
      parts.push(m.amount ? `${m.amount.toLocaleString()}원` : null, reason);
      return { label: '환불 요청', variant: 'destructive', detail: joinParts(parts) };

    case 'EXPIRED':
      return {
        label: '기간 만료',
        variant: 'outline',
        detail: m.reason === 'NATURAL_EXPIRATION' ? '이용 기간이 끝나 자동 종료' : reason,
      };

    default:
      return { label: eventType, variant: 'outline', detail: reason };
  }
}

function joinParts(parts: (string | null)[]): string | null {
  const kept = parts.filter((p): p is string => !!p);
  return kept.length ? kept.join(' · ') : null;
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
