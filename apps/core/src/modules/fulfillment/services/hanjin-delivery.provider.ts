import { Injectable, Logger, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import {
  DeliveryProvider,
  DeliveryRequest,
  DeliveryResponse,
  PrintResponse,
  TrackingResponse,
} from './delivery-provider.interface';

export interface HanjinConfig {
  apiUrl: string;
  apiKey: string;
  /** 한진 거래처(고객사) 코드 — 계약 승인 후 발급 */
  customerCode: string;
  /** 송하인/집하지 코드 — 계약 조건에 따라 미사용일 수 있음 */
  senderCode: string;
  pickupSiteCode: string;
  senderName: string;
  senderPhone: string;
  timeoutMs: number;
}

/**
 * 한진택배 DeliveryProvider.
 *
 * 계약/문서 확보 전 skeleton 상태: 호출 구조(인증 헤더, 요청 빌드, 응답 정규화, 상태 매핑)는
 * 완성되어 있고, 한진 공식 문서가 오면 `TODO(hanjin)` 표시된 endpoint/필드명/상태코드표만
 * 실제 스펙으로 교체하면 된다. env 미설정 시 모든 호출은 ServiceUnavailableException.
 */
@Injectable()
export class HanjinDeliveryProvider extends DeliveryProvider {
  private readonly logger = new Logger(HanjinDeliveryProvider.name);
  private readonly config: HanjinConfig;

  constructor() {
    super();
    this.config = {
      apiUrl: process.env.HANJIN_API_URL || '',
      apiKey: process.env.HANJIN_API_KEY || '',
      customerCode: process.env.HANJIN_CUSTOMER_CODE || '',
      senderCode: process.env.HANJIN_SENDER_CODE || '',
      pickupSiteCode: process.env.HANJIN_PICKUP_SITE_CODE || '',
      senderName: process.env.HANJIN_SENDER_NAME || 'AlmondYoung',
      senderPhone: process.env.HANJIN_SENDER_PHONE || '',
      timeoutMs: Number(process.env.HANJIN_TIMEOUT_MS) || 10_000,
    };

    if (!this.isConfigured()) {
      this.logger.warn(
        'Hanjin API configuration is incomplete — hanjin invoice issuance will fail until HANJIN_API_URL/HANJIN_API_KEY/HANJIN_CUSTOMER_CODE are set',
      );
    }
  }

  isConfigured(): boolean {
    return !!(this.config.apiUrl && this.config.apiKey && this.config.customerCode);
  }

  private ensureConfigured(): void {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'Hanjin API is not configured (HANJIN_API_URL / HANJIN_API_KEY / HANJIN_CUSTOMER_CODE). ' +
          '한진 계약 승인 후 secret 을 등록해야 합니다. 그 전에는 issueMethod=direct/self 를 사용하세요.',
      );
    }
  }

  async issueInvoice(request: DeliveryRequest): Promise<DeliveryResponse> {
    this.ensureConfigured();
    try {
      // TODO(hanjin): 공식 문서 확보 후 실제 요청 필드명으로 교체.
      // 필수 후보: 거래처 코드, 집하지 코드, 수취인 정보, 박스 수량, 운임 구분.
      const payload = {
        customerCode: this.config.customerCode,
        senderCode: this.config.senderCode || undefined,
        pickupSiteCode: this.config.pickupSiteCode || undefined,
        senderName: request.senderName || this.config.senderName,
        senderPhone: request.senderPhone || this.config.senderPhone,
        recipientName: request.recipientName,
        recipientAddress: request.recipientAddress,
        recipientPhone: request.recipientPhone,
        deliveryMessage: request.deliveryMessage || '',
        items: request.items.map((item) => ({
          productName: item.productName,
          quantity: item.quantity,
          price: item.price,
        })),
      };

      // TODO(hanjin): endpoint 경로 확정 필요
      const response = await this.makeRequest('/v1/waybills', 'POST', payload);

      this.logger.log(`Issued invoice via Hanjin: ${response.waybillNo}`);

      // TODO(hanjin): 응답 필드명(waybillNo 등) 공식 스펙으로 교체.
      // serviceId 는 invoices.goodsflowServiceId(외부 service id 공용 컬럼)에 저장된다 —
      // 한진이 별도 접수 id 를 주지 않으면 운송장 번호를 그대로 쓴다.
      return {
        serviceId: response.serviceId ?? response.waybillNo,
        invoiceNumber: response.waybillNo,
        carrierCode: 'HANJIN',
        estimatedDeliveryDate: response.estimatedDeliveryDate,
      };
    } catch (error) {
      this.logger.error('Failed to issue invoice via Hanjin:', error);
      throw new BadRequestException('Failed to issue invoice via Hanjin');
    }
  }

  async generatePrintUri(serviceIds: string[]): Promise<PrintResponse> {
    this.ensureConfigured();
    try {
      // TODO(hanjin): 출력 방식 확정 필요 — 출력 페이지 URI 방식인지, 라벨 데이터(ZPL/PDF) 응답 방식인지.
      // 라벨 데이터 방식이면 file-service 업로드 후 그 URL 을 printUri 로 반환하는 형태로 확장.
      const payload = { waybillNos: serviceIds };
      const response = await this.makeRequest('/v1/waybills/print', 'POST', payload);

      this.logger.log(`Generated print URI for ${serviceIds.length} Hanjin invoices`);

      return {
        printUri: response.printUri,
        expiresAt: response.expiresAt ? new Date(response.expiresAt) : undefined,
      };
    } catch (error) {
      this.logger.error('Failed to generate print URI via Hanjin:', error);
      throw new BadRequestException('Failed to generate print URI via Hanjin');
    }
  }

  async trackDelivery(serviceId: string): Promise<TrackingResponse> {
    this.ensureConfigured();
    try {
      // TODO(hanjin): 추적 endpoint/응답 스펙 확정 필요
      const response = await this.makeRequest(`/v1/waybills/${encodeURIComponent(serviceId)}/tracking`, 'GET');

      return {
        serviceId,
        invoiceNumber: response.waybillNo ?? serviceId,
        status: this.mapHanjinStatus(response.status),
        location: response.location,
        timestamp: response.timestamp ? new Date(response.timestamp) : new Date(),
        description: response.description,
      };
    } catch (error) {
      this.logger.error(`Failed to track delivery ${serviceId} via Hanjin:`, error);
      throw new BadRequestException('Failed to track delivery via Hanjin');
    }
  }

  async cancelInvoice(serviceId: string): Promise<void> {
    this.ensureConfigured();
    try {
      // TODO(hanjin): 취소 가능 상태(집하 전만 가능 등)와 취소 endpoint 확정 필요
      await this.makeRequest(`/v1/waybills/${encodeURIComponent(serviceId)}/cancel`, 'POST');
      this.logger.log(`Canceled invoice ${serviceId} via Hanjin`);
    } catch (error) {
      this.logger.error(`Failed to cancel invoice ${serviceId} via Hanjin:`, error);
      throw new BadRequestException('Failed to cancel invoice via Hanjin');
    }
  }

  private async makeRequest(endpoint: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', data?: unknown): Promise<any> {
    const url = `${this.config.apiUrl}${endpoint}`;
    // TODO(hanjin): 인증 방식 확정 필요 — API key 헤더명 또는 토큰 발급 선행 여부
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.apiKey}`,
      'X-Customer-Code': this.config.customerCode,
    };

    const response = await fetch(url, {
      method,
      headers,
      ...(data ? { body: JSON.stringify(data) } : {}),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      // TODO(hanjin): 에러 코드표 확보 후 분류 — 인증 실패 / 주소 오류 / 필수 코드 누락 / 중복 송장 / 취소 불가
      throw new Error(`Hanjin API error: ${response.status} - ${errorBody}`);
    }

    return response.json();
  }

  // TODO(hanjin): 공식 배송 상태 코드표 확보 후 case 를 실제 코드로 교체
  private mapHanjinStatus(hanjinStatus: string): TrackingResponse['status'] {
    switch (hanjinStatus) {
      case 'accepted':
      case 'pickup_scheduled':
        return 'pending';
      case 'picked_up':
      case 'in_transit':
      case 'out_for_delivery':
        return 'in_transit';
      case 'delivered':
        return 'delivered';
      case 'failed':
      case 'returned':
        return 'failed';
      case 'canceled':
        return 'canceled';
      default:
        return 'pending';
    }
  }
}
