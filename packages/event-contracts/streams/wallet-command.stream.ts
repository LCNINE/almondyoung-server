/**
 * Wallet Command Stream Configuration
 *
 * 외부 서비스(Membership 등)가 Wallet에 빌링 결제를 요청하기 위한 커맨드 스트림.
 * billing.charge 커맨드를 통해 정기결제를 트리거합니다.
 */

import { event, stream } from '../types';
import { z } from 'zod';

// ===== Command Payloads =====

export interface BillingChargePayload {
  /** 빌링 계약의 subscriberRef (e.g. subscriptionId) */
  subscriberRef: string;
  /** 빌링 계약의 subscriberType (e.g. "MEMBERSHIP") */
  subscriberType: string;
  /** 결제 금액 */
  amount: number;
  /** 통화 코드 */
  currency: string;
  /** 결제 목적 */
  purpose: 'SUBSCRIPTION' | 'REPAYMENT';
  /** 멱등성 키 — 동일 키의 중복 요청을 방지 */
  idempotencyKey: string;
  /** 추가 메타데이터 (주문 정보 등) */
  metadata?: Record<string, unknown>;
  /** 요청 시각 (ISO 8601) */
  requestedAt: string;
}

// ===== Zod Schemas =====

const BillingChargeSchema = z.object({
  subscriberRef: z.string().min(1),
  subscriberType: z.string().min(1),
  amount: z.number().int().positive(),
  currency: z.string().min(1),
  purpose: z.enum(['SUBSCRIPTION', 'REPAYMENT']),
  idempotencyKey: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
  requestedAt: z.string().datetime(),
});

// ===== Stream Config =====

export const WALLET_COMMAND_STREAM = stream({
  topic: 'wallet.commands.v1',
  partitions: 6,
  aggregateType: 'Wallet',
  events: {
    BillingCharge: event<'BillingCharge', BillingChargePayload>(
      'BillingCharge',
      BillingChargeSchema,
    ),
  },
});

export type WalletCommandEvents = typeof WALLET_COMMAND_STREAM.events;
