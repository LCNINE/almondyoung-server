import { Injectable, Logger } from '@nestjs/common';
import {
  DeliveryProvider,
  DeliveryProviderCapabilities,
  DeliveryProviderError,
  DeliveryProviderInvoiceQuery,
  DeliveryProviderInvoiceQueryResult,
  DeliveryRequest,
  DeliveryResponse,
  PrintResponse,
  ProviderOperationContext,
  TrackingResponse,
} from './delivery-provider.interface';

export interface GoodsflowConfig {
  apiUrl: string;
  apiKey: string;
  centerCode: string;
  timeoutMs: number;
}

const MAX_REQUEST_DURATION_MS = 30_000;

@Injectable()
export class GoodsflowDeliveryProvider extends DeliveryProvider {
  override readonly maxRequestDurationMs = MAX_REQUEST_DURATION_MS;
  override readonly capabilities: DeliveryProviderCapabilities = Object.freeze({
    // The currently integrated Goodsflow contract documents neither a provider
    // idempotency key nor lookup by that key. A V2 saga must therefore fail closed.
    issue: Object.freeze({ safeToRepeat: false, lookupByIdempotencyKey: false }),
    // Existing labels can be queried and voided by their known service id, but
    // repeated POST /cancel semantics are not documented as idempotent.
    void: Object.freeze({ safeToRepeat: false, lookupByServiceId: true }),
  });

  private readonly logger = new Logger(GoodsflowDeliveryProvider.name);
  private readonly config: GoodsflowConfig;

  constructor() {
    super();
    const configuredTimeoutMs = Number(process.env.GOODSFLOW_TIMEOUT_MS);
    this.config = {
      apiUrl: process.env.GOODSFLOW_API_URL || 'https://api.goodsflow.com',
      apiKey: process.env.GOODSFLOW_API_KEY || '',
      centerCode: process.env.GOODSFLOW_CENTER_CODE || '',
      timeoutMs: Math.min(configuredTimeoutMs > 0 ? configuredTimeoutMs : 10_000, MAX_REQUEST_DURATION_MS),
    };

    if (!this.config.apiKey || !this.config.centerCode) {
      this.logger.warn('Goodsflow API configuration is incomplete');
    }
  }

  async issueInvoice(request: DeliveryRequest, _context?: ProviderOperationContext): Promise<DeliveryResponse> {
    this.ensureConfigured();
    try {
      const payload = {
        center_code: request.centerCode || this.config.centerCode,
        recipient_name: request.recipientName,
        recipient_address: request.recipientAddress,
        recipient_phone: request.recipientPhone,
        sender_name: request.senderName || 'AlmondYoung',
        sender_phone: request.senderPhone || '02-1234-5678',
        carrier_code: request.carrierCode,
        delivery_message: request.deliveryMessage || '',
        items: request.items.map((item) => ({
          product_name: item.productName,
          quantity: item.quantity,
          price: item.price,
        })),
      };

      const response = await this.makeRequest('/v1/invoices', 'POST', payload);

      if (!response?.service_id || !response?.invoice_number || !response?.carrier_code) {
        throw new DeliveryProviderError(
          'Goodsflow returned an invalid invoice response after issue',
          'unknown_outcome',
          { provider: 'goodsflow' },
        );
      }

      this.logger.log(`Issued invoice via Goodsflow: ${response.service_id}`);

      return {
        serviceId: response.service_id,
        invoiceNumber: response.invoice_number,
        carrierCode: response.carrier_code,
        estimatedDeliveryDate: response.estimated_delivery_date,
      };
    } catch (error) {
      this.logger.error('Failed to issue invoice via Goodsflow:', error);
      throw this.normalizeError(error, 'Issue invoice outcome is unknown');
    }
  }

  async generatePrintUri(serviceIds: string[]): Promise<PrintResponse> {
    this.ensureConfigured();
    try {
      const payload = { service_ids: serviceIds };
      const response = await this.makeRequest('/v1/invoices/print', 'POST', payload);
      this.logger.log(`Generated print URI for ${serviceIds.length} invoices`);
      return {
        printUri: response.print_uri,
        expiresAt: response.expires_at ? new Date(response.expires_at) : undefined,
      };
    } catch (error) {
      this.logger.error('Failed to generate print URI via Goodsflow:', error);
      throw this.normalizeError(error, 'Failed to generate print URI');
    }
  }

  async trackDelivery(serviceId: string): Promise<TrackingResponse> {
    this.ensureConfigured();
    try {
      const response = await this.makeRequest(
        `/v1/invoices/${encodeURIComponent(serviceId)}/tracking`,
        'GET',
        undefined,
        { notFoundMeansMissing: true },
      );
      if (!response?.invoice_number || !response?.status) {
        throw new DeliveryProviderError('Goodsflow returned an invalid tracking response', 'unknown_outcome', {
          provider: 'goodsflow',
        });
      }
      return {
        serviceId: response.service_id || serviceId,
        invoiceNumber: response.invoice_number,
        status: this.mapGoodsflowStatus(response.status),
        location: response.location,
        timestamp: new Date(response.timestamp),
        description: response.description,
      };
    } catch (error) {
      this.logger.error(`Failed to track delivery ${serviceId} via Goodsflow:`, error);
      throw this.normalizeError(error, 'Failed to track delivery');
    }
  }

  async cancelInvoice(serviceId: string, _context?: ProviderOperationContext): Promise<void> {
    this.ensureConfigured();
    try {
      await this.makeRequest(`/v1/invoices/${encodeURIComponent(serviceId)}/cancel`, 'POST', undefined, {
        notFoundMeansMissing: true,
      });
      this.logger.log(`Canceled invoice ${serviceId} via Goodsflow`);
    } catch (error) {
      this.logger.error(`Failed to cancel invoice ${serviceId} via Goodsflow:`, error);
      throw this.normalizeError(error, 'Cancel invoice outcome is unknown');
    }
  }

  override async queryInvoice(query: DeliveryProviderInvoiceQuery): Promise<DeliveryProviderInvoiceQueryResult> {
    if (!query.serviceId) {
      throw new DeliveryProviderError(
        'Goodsflow invoice lookup requires a known service id; idempotency-key lookup is not supported',
        'unsupported',
        { provider: 'goodsflow' },
      );
    }

    try {
      const tracking = await this.trackDelivery(query.serviceId);
      return {
        status: 'found',
        serviceId: tracking.serviceId,
        invoiceNumber: tracking.invoiceNumber,
        tracking,
      };
    } catch (error) {
      if (error instanceof DeliveryProviderError && error.outcome === 'not_found') {
        return { status: 'not_found' };
      }
      throw error;
    }
  }

  private ensureConfigured(): void {
    if (!this.config.apiKey || !this.config.centerCode) {
      throw new DeliveryProviderError('Goodsflow API configuration is incomplete', 'definitive_rejection', {
        provider: 'goodsflow',
        providerCode: 'configuration_error',
      });
    }
  }

  private async makeRequest(
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    data?: unknown,
    semantics: { notFoundMeansMissing?: boolean } = {},
  ): Promise<any> {
    const url = `${this.config.apiUrl}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.apiKey}`,
      'X-Center-Code': this.config.centerCode,
    };

    const options: RequestInit = {
      method,
      headers,
      ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
    };

    let response: Response;
    try {
      response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      throw new DeliveryProviderError('Goodsflow request did not produce a definitive response', 'unknown_outcome', {
        provider: 'goodsflow',
        providerCode: error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'transport_error',
        cause: error,
      });
    }

    if (!response.ok) {
      const errorData = await response.text();
      const details = {
        provider: 'goodsflow',
        providerCode: `http_${response.status}`,
        httpStatus: response.status,
      };
      if (response.status === 404 && semantics.notFoundMeansMissing) {
        throw new DeliveryProviderError(`Goodsflow invoice not found: ${errorData}`, 'not_found', details);
      }
      if (response.status === 408 || response.status === 429 || response.status >= 500) {
        throw new DeliveryProviderError(
          `Goodsflow request outcome is unknown: ${response.status} - ${errorData}`,
          'unknown_outcome',
          details,
        );
      }
      throw new DeliveryProviderError(
        `Goodsflow request was rejected: ${response.status} - ${errorData}`,
        'definitive_rejection',
        details,
      );
    }

    if (response.status === 204) return {};

    try {
      return await response.json();
    } catch (error) {
      throw new DeliveryProviderError('Goodsflow returned an invalid JSON response', 'unknown_outcome', {
        provider: 'goodsflow',
        providerCode: 'invalid_response',
        httpStatus: response.status,
        cause: error,
      });
    }
  }

  private normalizeError(error: unknown, fallbackMessage: string): DeliveryProviderError {
    if (error instanceof DeliveryProviderError) return error;
    return new DeliveryProviderError(fallbackMessage, 'unknown_outcome', {
      provider: 'goodsflow',
      cause: error,
    });
  }

  private mapGoodsflowStatus(goodsflowStatus: string): TrackingResponse['status'] {
    switch (goodsflowStatus) {
      case 'pending':
      case 'processing':
        return 'pending';
      case 'shipped':
      case 'in_delivery':
        return 'in_transit';
      case 'delivered':
        return 'delivered';
      case 'failed':
      case 'exception':
        return 'failed';
      case 'canceled':
        return 'canceled';
      default:
        return 'pending';
    }
  }
}
