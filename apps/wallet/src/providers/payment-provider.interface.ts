export interface ValidateMethodParams {
  customerId: string;
  externalUserId: string;
  type: string;
  providerData?: Record<string, unknown>;
}

export interface DeleteMethodParams {
  customerId: string;
  externalUserId: string;
  paymentMethodId: string;
  providerData?: Record<string, unknown>;
}

export interface ChargeParams {
  /** charge.id – used as legId in the points ledger */
  chargeId: string;
  intentId: string;
  paymentMethodId: string;
  customerId: string;
  /** The external user identifier (e.g. Medusa user_id) */
  externalUserId: string;
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
  customerId: string;
  externalUserId: string;
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
  externalUserId: string;
  providerTransactionId?: string;
}

export interface ChargeStatusResult {
  status: 'SUCCEEDED' | 'FAILED' | 'PENDING' | 'REQUIRES_ACTION' | 'CANCELED';
  raw?: Record<string, unknown>;
}

export interface PaymentProvider {
  readonly providerType: string;

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
