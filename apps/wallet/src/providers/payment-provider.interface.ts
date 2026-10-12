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

/** 가상계좌(무통장) 환불 시 환불받을 계좌 — 토스가 이 계좌로 송금한다. */
export interface RefundReceiveAccount {
  /** 토스 2자리 은행코드 (예: 국민 06) */
  bank: string;
  accountNumber: string;
  holderName: string;
}

export interface RefundParams {
  refundId: string;
  chargeId: string;
  /**
   * provider 원장이 이 결제분을 아는 id. 확정(CAPTURE)분이면 그 승인(AUTHORIZE)분 id 다 —
   * 확정 때 provider 에 승인분 id 를 넘기기 때문이다(`ledgerLegChargeId`). 포인트 provider 만 읽는다.
   */
  authorizeChargeId?: string;
  intentId: string;
  userId: string;
  amount: number;
  currency: string;
  idempotencyKey: string;
  correlationId: string;
  reasonCode?: string;
  providerData?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  /** 무통장(가상계좌) 입금 후 환불에 필요. 미제공 시 provider 는 수동환불(PENDING) 로 폴백. */
  refundReceiveAccount?: RefundReceiveAccount;
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
  /**
   * FAILED 일 때만 의미: 같은 환불을 나중에 다시 시도하면 될 수 있는가. 없으면 true(일시)로 본다 —
   * 모르는 실패를 영구로 두면 아무도 다시 안 부른다. 영구/일시 분류의 정본은 wallet 이다(스펙 S6).
   */
  retryable?: boolean;
  /**
   * PENDING 일 때만 의미: PG 를 부르지 않았다 — 운영자가 고객 계좌로 송금하고 [완료 처리](confirmManual)를 눌러야 끝난다.
   * wallet 은 이 행을 execution MANUAL 로 적는다. 없으면 PG 가 비동기로 처리 중인 PENDING 이다(#1016 36번 마무리 ②).
   */
  manualTransfer?: boolean;
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
