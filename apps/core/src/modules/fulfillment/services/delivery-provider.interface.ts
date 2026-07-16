export interface DeliveryRequest {
  centerCode: string;
  recipientName: string;
  recipientAddress: string;
  recipientPhone: string;
  items: Array<{
    productName: string;
    quantity: number;
    price: number;
  }>;
  carrierCode: string;
  senderName?: string;
  senderPhone?: string;
  deliveryMessage?: string;
}

/**
 * One stable context is reused for every attempt of the same invoice saga operation.
 * `idempotencyKey` is provider-facing; `operationId` is our durable correlation id.
 */
export interface ProviderOperationContext {
  operationId: string;
  idempotencyKey: string;
}

export interface DeliveryProviderCapabilities {
  issue: {
    /** Repeating issue with the same context is documented to return the same label. */
    safeToRepeat: boolean;
    /** An issue result can be recovered using only the stable idempotency key. */
    lookupByIdempotencyKey: boolean;
  };
  void: {
    /** Repeating void for the same service id is documented as safe. */
    safeToRepeat: boolean;
    /** The current label state can be queried when its provider service id is known. */
    lookupByServiceId: boolean;
  };
}

export type DeliveryProviderErrorOutcome = 'definitive_rejection' | 'unknown_outcome' | 'not_found' | 'unsupported';

/**
 * Normalized provider failure used by the invoice saga to decide whether it may retry.
 * Only `unknown_outcome` means that the remote side effect may have happened.
 */
export class DeliveryProviderError extends Error {
  readonly name = 'DeliveryProviderError';

  constructor(
    message: string,
    readonly outcome: DeliveryProviderErrorOutcome,
    readonly details: {
      provider?: string;
      providerCode?: string;
      httpStatus?: number;
      cause?: unknown;
    } = {},
  ) {
    super(message);
  }
}

export interface DeliveryProviderInvoiceQuery {
  serviceId?: string;
  idempotencyKey?: string;
}

export type DeliveryProviderInvoiceQueryResult =
  | {
      status: 'found';
      serviceId: string;
      invoiceNumber: string;
      tracking?: TrackingResponse;
    }
  | { status: 'not_found' };

const UNSUPPORTED_CAPABILITIES: DeliveryProviderCapabilities = Object.freeze({
  issue: Object.freeze({ safeToRepeat: false, lookupByIdempotencyKey: false }),
  void: Object.freeze({ safeToRepeat: false, lookupByServiceId: false }),
});

export interface DeliveryResponse {
  serviceId: string;
  invoiceNumber: string;
  carrierCode: string;
  estimatedDeliveryDate?: string;
}

export interface PrintResponse {
  printUri: string;
  expiresAt?: Date;
}

export interface TrackingResponse {
  serviceId: string;
  invoiceNumber: string;
  status: 'pending' | 'in_transit' | 'delivered' | 'failed' | 'canceled';
  location?: string;
  timestamp: Date;
  description?: string;
}

export abstract class DeliveryProvider {
  readonly capabilities: DeliveryProviderCapabilities = UNSUPPORTED_CAPABILITIES;
  /** Hard upper bound for one provider call; must be shorter than the saga lease. */
  abstract readonly maxRequestDurationMs: number;

  abstract issueInvoice(request: DeliveryRequest, context?: ProviderOperationContext): Promise<DeliveryResponse>;
  abstract generatePrintUri(serviceIds: string[]): Promise<PrintResponse>;
  abstract trackDelivery(serviceId: string): Promise<TrackingResponse>;
  abstract cancelInvoice(serviceId: string, context?: ProviderOperationContext): Promise<void>;

  async queryInvoice(
    _query: DeliveryProviderInvoiceQuery,
    _context?: ProviderOperationContext,
  ): Promise<DeliveryProviderInvoiceQueryResult> {
    throw new DeliveryProviderError('Invoice lookup is not supported by this provider', 'unsupported');
  }
}
