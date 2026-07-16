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

export interface HanjinConfig {
  apiUrl: string;
  apiKey: string;
  /** 한진 거래처(고객사) 코드 — 계약 승인 후 발급 */
  customerCode: string;
}

/**
 * 한진택배 provider fail-closed adapter.
 *
 * 공식 endpoint, 인증, request/response 필드, 멱등성 및 조회 계약이 아직 확정되지 않았다.
 * 예전 skeleton의 추정 endpoint를 호출하면 timeout 뒤 중복 송장을 안전하게 복구할 수 없으므로,
 * credential 유무와 관계없이 외부 호출을 하지 않는다. 공식 계약과 sandbox evidence가 확보되면
 * capability를 사실에 맞게 활성화하고 이 adapter를 구현해야 한다.
 */
@Injectable()
export class HanjinDeliveryProvider extends DeliveryProvider {
  override readonly maxRequestDurationMs = 0;
  override readonly capabilities: DeliveryProviderCapabilities = Object.freeze({
    issue: Object.freeze({ safeToRepeat: false, lookupByIdempotencyKey: false }),
    void: Object.freeze({ safeToRepeat: false, lookupByServiceId: false }),
  });

  private readonly logger = new Logger(HanjinDeliveryProvider.name);
  private readonly config: HanjinConfig;

  constructor() {
    super();
    this.config = {
      apiUrl: process.env.HANJIN_API_URL || '',
      apiKey: process.env.HANJIN_API_KEY || '',
      customerCode: process.env.HANJIN_CUSTOMER_CODE || '',
    };

    this.logger.warn(
      this.hasCredentials()
        ? 'Hanjin credentials are present, but the official API contract is not verified — provider remains disabled'
        : 'Hanjin API credentials and official contract are unavailable — provider remains disabled',
    );
  }

  /** Whether this provider is safe for production calls, not merely whether env vars exist. */
  isConfigured(): boolean {
    return false;
  }

  hasCredentials(): boolean {
    return !!(this.config.apiUrl && this.config.apiKey && this.config.customerCode);
  }

  async issueInvoice(_request: DeliveryRequest, _context?: ProviderOperationContext): Promise<DeliveryResponse> {
    throw this.unsupported('issue');
  }

  async generatePrintUri(_serviceIds: string[]): Promise<PrintResponse> {
    throw this.unsupported('print');
  }

  async trackDelivery(_serviceId: string): Promise<TrackingResponse> {
    throw this.unsupported('track');
  }

  async cancelInvoice(_serviceId: string, _context?: ProviderOperationContext): Promise<void> {
    throw this.unsupported('void');
  }

  override async queryInvoice(_query: DeliveryProviderInvoiceQuery): Promise<DeliveryProviderInvoiceQueryResult> {
    throw this.unsupported('query');
  }

  private unsupported(operation: string): DeliveryProviderError {
    return new DeliveryProviderError(
      `Hanjin ${operation} is disabled until the official API and idempotency/recovery contract is verified`,
      'unsupported',
      {
        provider: 'hanjin',
        providerCode: this.hasCredentials() ? 'contract_unverified' : 'configuration_and_contract_unavailable',
      },
    );
  }
}
