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

/**
 * ADR-0027 §4-1. 구독 주기마다 인보이스(미수금) 생성을 요청하는 커맨드.
 * wallet 이 인보이스를 생성하고 이후 집행(승인 대기·출금·재시도·정산)을 전담한다.
 */
export interface CreateInvoicePayload {
  subscriberType: string;
  /** membership contractId */
  subscriberRef: string;
  /**
   * 청구 대상 결제수단. 생략하면 wallet 이 활성 billing_agreement 로 해석한다(갱신 주기 발행 경로).
   */
  billingMethodId?: string;
  amount: number;
  currency: string;
  /** 이 인보이스가 커버하는 구독 주기 (YYYY-MM-DD) */
  periodStart: string;
  periodEnd: string;
  /** 최초 출금 예정일 (YYYY-MM-DD) */
  dueDate: string;
  /** 주기당 1 자연 키 — 예: 'membership:invoice:<contractId>:<periodStart>' */
  idempotencyKey: string;
  /** 재시도 정책 — subscriber 가 실어준다(ADR-0027 §10-1). 생략 시 wallet 기본값(3회/72h). */
  maxAttempts?: number;
  retryIntervalHours?: number;
  metadata?: Record<string, unknown>;
  requestedAt: string;
}

/** ADR-0027 §4-1. 구독 취소/해지 시 열린 인보이스 무효화. */
export interface VoidInvoicePayload {
  subscriberType: string;
  subscriberRef: string;
  reason: string;
  requestedAt: string;
}

// ===== Zod Schemas =====

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

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

const CreateInvoiceSchema = z.object({
  subscriberType: z.string().min(1),
  subscriberRef: z.string().min(1),
  billingMethodId: z.string().uuid().optional(),
  // 0원 정기청구 금지 — BillingCharge 와 동일 정책. 무료 플랜은 청구 자체를 만들지 않는다.
  amount: z.number().int().positive(),
  currency: z.string().min(1),
  periodStart: isoDate,
  periodEnd: isoDate,
  dueDate: isoDate,
  idempotencyKey: z.string().min(1),
  maxAttempts: z.number().int().positive().optional(),
  retryIntervalHours: z.number().int().positive().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  requestedAt: z.string().datetime(),
});

const VoidInvoiceSchema = z.object({
  subscriberType: z.string().min(1),
  subscriberRef: z.string().min(1),
  reason: z.string().min(1),
  requestedAt: z.string().datetime(),
});

// ===== Stream Config =====

export const WALLET_COMMAND_STREAM = stream({
  topic: 'wallet.commands.v1',
  partitions: 6,
  aggregateType: 'Wallet',
  events: {
    BillingCharge: event<'BillingCharge', BillingChargePayload>('BillingCharge', BillingChargeSchema),
    CreateInvoice: event<'CreateInvoice', CreateInvoicePayload>('CreateInvoice', CreateInvoiceSchema),
    VoidInvoice: event<'VoidInvoice', VoidInvoicePayload>('VoidInvoice', VoidInvoiceSchema),
  },
});

export type WalletCommandEvents = typeof WALLET_COMMAND_STREAM.events;
