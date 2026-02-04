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
  email: string;
  status: MembershipStatus;
  occurredAt: string; // ISO 8601
  contractId?: string;
  tierId?: string;
  planId?: string;
  reasonCode?: string;
  reasonText?: string;
}

// ===== Zod 스키마 정의 =====

const MembershipStatusChangedSchema = z.object({
  userId: z.string().min(1),
  email: z.string().email(),
  status: MembershipStatusSchema,
  occurredAt: z.string().datetime(),
  contractId: z.string().min(1).optional(),
  tierId: z.string().min(1).optional(),
  planId: z.string().min(1).optional(),
  reasonCode: z.string().min(1).optional(),
  reasonText: z.string().optional(),
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
