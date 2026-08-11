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
  },
});

export type MembershipEvents = typeof MEMBERSHIP_STREAM.events;
