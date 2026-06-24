export interface ValidateMethodParams {
  userId: string;
  type: string;
  providerData?: Record<string, unknown>;
}

export interface DeleteMethodParams {
  userId: string;
  paymentMethodId: string;
  providerData?: Record<string, unknown>;
}

export interface ChargeParams {
  /** charge.id – used as legId in the points ledger */
  chargeId: string;
  intentId: string;
  paymentMethodId: string;
  /** The user identifier (e.g. Medusa user_id) */
  userId: string;
  amount: number;
  currency: string;
  idempotencyKey: string;
  correlationId: string;
  providerData?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface RefundParams {
  refundId: string;
  chargeId: string;
  intentId: string;
  userId: string;
  amount: number;
  currency: string;
  idempotencyKey: string;
  correlationId: string;
  reasonCode?: string;
  providerData?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ChargeResult {
  /** SUCCEEDED – charge fully processed; FAILED – irrecoverable error; PENDING – async; REQUIRES_ACTION – needs user */
  status: 'SUCCEEDED' | 'FAILED' | 'PENDING' | 'REQUIRES_ACTION';
  providerTransactionId?: string;
  errorCode?: string;
  errorMessage?: string;
  nextAction?: Record<string, unknown>;
  raw?: Record<string, unknown>;
}

export interface RefundResult {
  status: 'SUCCEEDED' | 'FAILED' | 'PENDING';
  providerRefundId?: string;
  errorCode?: string;
  errorMessage?: string;
  raw?: Record<string, unknown>;
}

export interface GetStatusParams {
  chargeId: string;
  intentId: string;
  userId: string;
  providerTransactionId?: string;
}

export interface ChargeStatusResult {
  status: 'SUCCEEDED' | 'FAILED' | 'PENDING' | 'REQUIRES_ACTION' | 'CANCELED';
  raw?: Record<string, unknown>;
}

import { PaymentMethod } from '../types';

export type { PaymentMethod };

export interface PaymentProvider {
  readonly providerType: string;
  readonly autoCapture: boolean;

  /**
   * REQUIRES_ACTION의 의미를 선언한다.
   * - 'interactive'  : Toss 등 짧은 외부 리다이렉트. 짧은 actionExpiresAt로 빠르게 reclaim.
   * - 'offline-wait' : 무통장 등 오프라인 입금 대기. 긴 입금 윈도우(expiresAt) 동안 유지.
   */
  readonly actionMode: 'interactive' | 'offline-wait';

  /**
   * 이 provider 소속 결제수단 목록 반환.
   * singleton provider(POINTS 등)는 없으면 자동 생성 후 반환.
   * multi provider(CARD 등)는 등록된 것만 반환.
   */
  getUserMethods(userId: string): Promise<PaymentMethod[]>;

  /** Validate that a payment method can be registered (called at method creation) */
  validateMethod(params: ValidateMethodParams): Promise<void>;

  /** Called when deleting a payment method */
  deleteMethod(params: DeleteMethodParams): Promise<void>;

  /** Create an authorization hold */
  authorize(params: ChargeParams): Promise<ChargeResult>;

  /** Capture a previously authorized hold */
  capture(params: ChargeParams): Promise<ChargeResult>;

  /** Cancel/void an authorization or capture */
  cancel(params: ChargeParams): Promise<ChargeResult>;

  /** Issue a refund against a captured charge */
  refund(params: RefundParams): Promise<RefundResult>;

  /** Phase 2: poll async charge status (Toss, etc.) */
  getStatus?(params: GetStatusParams): Promise<ChargeStatusResult>;
}
