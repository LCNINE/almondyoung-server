export type ProviderOperation =
  | 'AUTHORIZE'
  | 'CAPTURE'
  | 'CANCEL'
  | 'REFUND'
  | 'MANUAL_CONFIRM';

export type ProviderCapability =
  | 'AUTHORIZE'
  | 'CAPTURE'
  | 'CANCEL'
  | 'REFUND'
  | 'PARTIAL_REFUND'
  | 'MANUAL_CONFIRM'
  | 'CUSTOMER_ACTION'
  | 'WEBHOOK'
  | 'POLL_STATUS'
  | 'AUTO_COMPENSATE';

export interface CapabilityContext {
  intentId: string;
  legId?: string;
  customerId?: string;
  amount?: number;
  currency?: string;
  metadata?: Record<string, unknown>;
}

export interface ValidateLegRequest {
  intentId: string;
  customerId: string;
  amount: number;
  currency: string;
  sequenceNo: number;
  isRequired: boolean;
  metadata?: Record<string, unknown>;
}

export interface ProviderOperationRequest {
  intentId: string;
  legId: string;
  attemptId?: string;
  amount: number;
  currency: string;
  customerId: string;
  idempotencyKey?: string;
  correlationId: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderOperationResult {
  resultStatus:
    | 'AUTHORIZED'
    | 'CAPTURED'
    | 'CANCELLED'
    | 'REFUNDED'
    | 'REQUIRES_CUSTOMER_ACTION'
    | 'REQUIRES_ADMIN_CONFIRMATION'
    | 'FAILED';
  providerTransactionId?: string;
  providerRequestId?: string;
  nextAction?: Record<string, unknown>;
  raw?: Record<string, unknown>;
}

export interface ProviderTransactionSnapshot {
  providerTransactionId?: string;
  status: string;
  raw?: Record<string, unknown>;
}

export interface PaymentProvider {
  readonly providerType: string;
  readonly version: string;

  getStaticCapabilities(): ProviderCapability[];
  resolveRuntimeCapabilities(ctx: CapabilityContext): ProviderCapability[];
  supports(operation: ProviderOperation, ctx?: CapabilityContext): boolean;

  validateLeg(req: ValidateLegRequest): Promise<void>;
  authorize(req: ProviderOperationRequest): Promise<ProviderOperationResult>;
  capture(req: ProviderOperationRequest): Promise<ProviderOperationResult>;
  cancel(req: ProviderOperationRequest): Promise<ProviderOperationResult>;
  refund(req: ProviderOperationRequest): Promise<ProviderOperationResult>;
  manualConfirm(req: ProviderOperationRequest): Promise<ProviderOperationResult>;
  getTransaction(
    req: Pick<ProviderOperationRequest, 'intentId' | 'legId' | 'correlationId'>,
  ): Promise<ProviderTransactionSnapshot>;
}
