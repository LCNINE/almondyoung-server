/**
 * Membership Domain Stream Configuration
 *
 * 멤버십 도메인 이벤트 스트림 정의
 */

import { event, stream } from '../types';
import { z } from 'zod';

// ===== Payload 타입 정의 =====

export const MembershipStatusSchema = z.enum([
  'ACTIVE',
  'PAUSED',
  'RESUMED',
  'CANCELLED',
  'RECURRING_CANCELLED',
  'EXPIRED',
]);

export type MembershipStatus = z.infer<typeof MembershipStatusSchema>;

export interface MembershipStatusChangedPayload {
  userId: string;
  email?: string;
  status: MembershipStatus;
  occurredAt: string; // ISO 8601
  contractId?: string;
  tierId?: string;
  planId?: string;
  reasonCode?: string;
  reasonText?: string;
  /** 이용 종료일 (YYYY-MM-DD). 해지 안내 메일이 "언제까지 쓸 수 있는지" 알리는 데 쓴다. */
  periodEndsAt?: string;
  /** 해지에 따른 환불 금액(원). 0 이면 환불 없음. */
  refundAmount?: number;
  /** 환불 처리 상태. PENDING 은 계좌 송금 대기(효성 CMS 등)로 안내 문구가 달라진다. */
  refundStatus?: 'COMPLETED' | 'PENDING' | 'FAILED' | 'NOT_APPLICABLE';
}

/**
 * 자동갱신 결제 사전 고지 (전자상거래법 계속거래 고지).
 *
 * 결제 예정일 N일 전에 membership 크론이 발행하고 notification 이 메일로 옮긴다.
 * 알림 서비스는 사용자 조회를 하지 않으므로 email·userName 을 여기 실어 보낸다.
 */
export interface MembershipRenewalUpcomingPayload {
  userId: string;
  email: string;
  userName: string;
  contractId: string;
  planName: string;
  /** 결제 예정일 (YYYY-MM-DD) */
  nextBillingDate: string;
  /** 결제 예정 금액(원) */
  amount: number;
  /** 결제 수단 표기 (예: '자동이체(CMS)') */
  paymentMethodLabel: string;
  /** 현재 결제한 기간의 종료일 (YYYY-MM-DD) */
  currentPeriodEnd: string;
  /** 갱신 시 늘어날 기간의 종료일 (YYYY-MM-DD) */
  nextPeriodEnd: string;
  /** 고지 시점과 결제일 사이 일수 (기본 7) */
  noticeDaysBefore: number;
  occurredAt: string; // ISO 8601
}

/**
 * 만료 사전 고지 — 자동갱신이 예정돼 있지 않은 이용권이 곧 끝난다는 안내.
 *
 * 1회 결제, 정기결제 해지 예약, 관리자 부여를 모두 포함한다. 자동갱신되는 계약은
 * MembershipRenewalUpcoming 이 담당하므로 두 고지가 같은 사람에게 겹치지 않는다.
 * 계약 없이 부여된 이용권도 있어 contractId 는 선택이다.
 */
export interface MembershipExpiryUpcomingPayload {
  userId: string;
  email: string;
  userName: string;
  /** 고지 대상 이용권 */
  entitlementId: string;
  planName: string;
  /** 이용 종료일 (YYYY-MM-DD) */
  expiresAt: string;
  /** 고지 시점과 종료일 사이 일수 (기본 7) */
  noticeDaysBefore: number;
  occurredAt: string; // ISO 8601
}

/**
 * 정기결제 출금 실패 안내 — 재시도가 남은 실패(1·2회차)마다 한 번.
 *
 * 마지막 시도의 실패는 이 이벤트가 아니라 {@link MembershipTerminatedForNonPaymentPayload} 로 온다.
 * 알림 서비스는 사용자 조회를 하지 않으므로 이름·전화번호를 여기 실어 보낸다.
 */
export interface MembershipBillingAttemptFailedPayload {
  userId: string;
  userName: string;
  phoneNumber: string;
  contractId: string;
  invoiceId: string;
  /** 청구 주기 (YYYY-MM-DD). 옛 wallet 은 싣지 않아 없을 수 있다. */
  periodStart?: string;
  periodEnd?: string;
  /** 청구 금액(원). 옛 wallet 은 싣지 않아 없을 수 있다. */
  amount?: number;
  /** 이번이 몇 번째 실패인지 (1부터) */
  attemptCount: number;
  maxAttempts: number;
  remainingAttempts: number;
  /** 다음 출금 «요청» 시각 (ISO 8601). 은행 영업일에 따라 실제 출금은 늦어질 수 있다. */
  nextAttemptRequestAt: string;
  /** 은행이 준 실패 사유 원문(짧게). 없으면 null */
  reasonText: string | null;
  occurredAt: string; // ISO 8601
}

/**
 * 요금을 못 걷어 멤버십이 해지됐다는 안내.
 *
 * 미납 요금이 원장에 적혔으면 arrearsAmount 에 그 금액이, 적히지 않았으면 null 과 그 이유가 온다.
 * cause 가 없으면 출금 재시도를 모두 실패한 해지(UNCOLLECTIBLE)다 — 이 칸이 생기기 전 이벤트가 그랬다.
 * 자동이체 계좌 심사 거절(MANDATE_REJECTED)로 해지된 경우는 cause 로 구별한다 — 안내 문구가 다르다.
 */
export interface MembershipTerminatedForNonPaymentPayload {
  userId: string;
  userName: string;
  phoneNumber: string;
  contractId: string;
  invoiceId: string;
  periodStart?: string;
  periodEnd?: string;
  arrearsAmount: number | null;
  arrearsSkippedReason: MembershipArrearsSkippedReason | null;
  cause?: MembershipTerminationCause;
  occurredAt: string; // ISO 8601
}

export const MembershipTerminationCauseSchema = z.enum(['UNCOLLECTIBLE', 'MANDATE_REJECTED']);
export type MembershipTerminationCause = z.infer<typeof MembershipTerminationCauseSchema>;

export const MembershipArrearsSkippedReasonSchema = z.enum([
  'NO_ENTITLEMENT',
  'PERIOD_NOT_COVERED',
  'TERMS_NOT_IN_FORCE',
  'WITHDRAWAL_ELIGIBLE',
  'AMOUNT_UNKNOWN',
]);

export type MembershipArrearsSkippedReason = z.infer<typeof MembershipArrearsSkippedReasonSchema>;

// ===== Zod 스키마 정의 =====

const MembershipStatusChangedSchema = z.object({
  userId: z.string().min(1),
  email: z.string().email().optional(),
  status: MembershipStatusSchema,
  occurredAt: z.string().datetime(),
  contractId: z.string().min(1).optional(),
  tierId: z.string().min(1).optional(),
  planId: z.string().min(1).optional(),
  reasonCode: z.string().min(1).optional(),
  reasonText: z.string().optional(),
  periodEndsAt: z.string().min(1).optional(),
  refundAmount: z.number().nonnegative().optional(),
  refundStatus: z.enum(['COMPLETED', 'PENDING', 'FAILED', 'NOT_APPLICABLE']).optional(),
});

const MembershipRenewalUpcomingSchema = z.object({
  userId: z.string().min(1),
  email: z.string().email(),
  userName: z.string().min(1),
  contractId: z.string().min(1),
  planName: z.string().min(1),
  nextBillingDate: z.string().min(1),
  amount: z.number().nonnegative(),
  paymentMethodLabel: z.string().min(1),
  currentPeriodEnd: z.string().min(1),
  nextPeriodEnd: z.string().min(1),
  noticeDaysBefore: z.number().int().positive(),
  occurredAt: z.string().datetime(),
});

const MembershipExpiryUpcomingSchema = z.object({
  userId: z.string().min(1),
  email: z.string().email(),
  userName: z.string().min(1),
  entitlementId: z.string().min(1),
  planName: z.string().min(1),
  expiresAt: z.string().min(1),
  noticeDaysBefore: z.number().int().positive(),
  occurredAt: z.string().datetime(),
});

const MembershipBillingAttemptFailedSchema = z.object({
  userId: z.string().min(1),
  userName: z.string(),
  phoneNumber: z.string().min(1),
  contractId: z.string().min(1),
  invoiceId: z.string().min(1),
  periodStart: z.string().min(1).optional(),
  periodEnd: z.string().min(1).optional(),
  amount: z.number().int().nonnegative().optional(),
  attemptCount: z.number().int().positive(),
  maxAttempts: z.number().int().positive(),
  remainingAttempts: z.number().int().nonnegative(),
  nextAttemptRequestAt: z.string().min(1),
  reasonText: z.string().nullable(),
  occurredAt: z.string().datetime(),
});

const MembershipTerminatedForNonPaymentSchema = z.object({
  userId: z.string().min(1),
  userName: z.string(),
  phoneNumber: z.string().min(1),
  contractId: z.string().min(1),
  invoiceId: z.string().min(1),
  periodStart: z.string().min(1).optional(),
  periodEnd: z.string().min(1).optional(),
  arrearsAmount: z.number().int().positive().nullable(),
  arrearsSkippedReason: MembershipArrearsSkippedReasonSchema.nullable(),
  cause: MembershipTerminationCauseSchema.optional(),
  occurredAt: z.string().datetime(),
});

// ===== Stream Config =====

export const MEMBERSHIP_STREAM = stream({
  topic: 'membership.events.v1',
  partitions: 6,
  aggregateType: 'Membership',
  events: {
    MembershipStatusChanged: event<'MembershipStatusChanged', MembershipStatusChangedPayload>(
      'MembershipStatusChanged',
      MembershipStatusChangedSchema,
    ),
    MembershipRenewalUpcoming: event<'MembershipRenewalUpcoming', MembershipRenewalUpcomingPayload>(
      'MembershipRenewalUpcoming',
      MembershipRenewalUpcomingSchema,
    ),
    MembershipExpiryUpcoming: event<'MembershipExpiryUpcoming', MembershipExpiryUpcomingPayload>(
      'MembershipExpiryUpcoming',
      MembershipExpiryUpcomingSchema,
    ),
    MembershipBillingAttemptFailed: event<'MembershipBillingAttemptFailed', MembershipBillingAttemptFailedPayload>(
      'MembershipBillingAttemptFailed',
      MembershipBillingAttemptFailedSchema,
    ),
    MembershipTerminatedForNonPayment: event<
      'MembershipTerminatedForNonPayment',
      MembershipTerminatedForNonPaymentPayload
    >('MembershipTerminatedForNonPayment', MembershipTerminatedForNonPaymentSchema),
  },
});

export type MembershipEvents = typeof MEMBERSHIP_STREAM.events;
