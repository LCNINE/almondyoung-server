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
  },
});

export type MembershipEvents = typeof MEMBERSHIP_STREAM.events;
