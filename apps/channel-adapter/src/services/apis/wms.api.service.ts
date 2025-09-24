import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AxiosResponse } from 'axios';
import { DlqMonitoringService } from '../dlq-monitoring.service';

/**
 * WMS API 클라이언트 서비스
 *
 * CTO SoT 원칙에 따라 어댑터가 SoT인 데이터(판매채널 주문)를
 * WMS에 동기 요청으로 전달하는 역할을 담당합니다.
 *
 * @example
 * ```typescript
 * // 네이버에서 주문 수신 시
 * const wmsOrder = await wmsApi.createSalesOrder({
 *   channelOrderId: 'NAVER-12345',
 *   salesChannel: 'naver_smartstore',
 *   lines: [...]
 * });
 *
 * // 쿠팡에서 취소 요청 시
 * await wmsApi.cancelSalesOrder('ORDER-123');
 * ```
 */
@Injectable()
export class WmsApiService {
  private readonly logger = new Logger(WmsApiService.name);
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly maxRetries: number;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly dlqMonitoring: DlqMonitoringService,
  ) {
    this.baseUrl = this.configService.get<string>(
      'WMS_API_URL',
      'http://localhost:3001',
    );
    this.timeout = this.configService.get<number>('WMS_TIMEOUT', 10000);
    this.maxRetries = this.configService.get<number>('WMS_MAX_RETRIES', 3);

    // HTTP 서비스 기본 설정
    this.httpService.axiosRef.defaults.timeout = this.timeout;
    this.httpService.axiosRef.defaults.baseURL = this.baseUrl;

    this.logger.log(`🏭 WMS API 클라이언트 초기화 완료 (${this.baseUrl})`);
  }

  /**
   * 판매주문 생성
   *
   * @param orderData 주문 생성 데이터
   * @returns 생성된 WMS 주문 정보
   *
   * @example
   * ```typescript
   * const order = await wmsApi.createSalesOrder({
   *   channelOrderId: 'NAVER-12345',
   *   salesChannel: 'naver_smartstore',
   *   customer: { name: '김철수', email: 'kim@example.com' },
   *   shippingAddress: { ... },
   *   lines: [{
   *     variantId: 'VARIANT-001',
   *     quantity: 2,
   *     unitPrice: 15000
   *   }]
   * });
   * ```
   */
  async createSalesOrder(orderData: CreateSalesOrderDto): Promise<SalesOrder> {
    const startTime = Date.now();

    this.logger.log(
      `📝 [WMS] 판매주문 생성 요청: ${orderData.channelOrderId}`,
      {
        salesChannel: orderData.salesChannel,
        lineCount: orderData.lines?.length || 0,
      },
    );

    try {
      const response = await this.executeWithRetry(
        () =>
          firstValueFrom(
            this.httpService.post<SalesOrder>('/wms/sales-orders', orderData),
          ),
        `CREATE_SALES_ORDER:${orderData.channelOrderId}`,
      );

      const duration = Date.now() - startTime;
      this.logger.log(
        `✅ [WMS] 판매주문 생성 성공: ${response.data.id} (${duration}ms)`,
        {
          channelOrderId: orderData.channelOrderId,
          wmsOrderId: response.data.id,
          status: response.data.status,
        },
      );

      return response.data;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        `❌ [WMS] 판매주문 생성 실패: ${orderData.channelOrderId} (${duration}ms)`,
        {
          error: error.message,
          salesChannel: orderData.salesChannel,
        },
      );
      throw error;
    }
  }

  /**
   * 판매주문 수정
   *
   * @param orderId WMS 주문 ID 또는 (채널ID, 주문ID) 조합
   * @param updateData 수정할 데이터
   * @returns 수정된 주문 정보
   */
  async updateSalesOrder(
    orderId: string | { salesChannel: string; channelOrderId: string },
    updateData: UpdateSalesOrderDto,
  ): Promise<SalesOrder> {
    const identifier =
      typeof orderId === 'string'
        ? orderId
        : `${orderId.salesChannel}:${orderId.channelOrderId}`;

    this.logger.log(`📝 [WMS] 판매주문 수정 요청: ${identifier}`);

    try {
      const url =
        typeof orderId === 'string'
          ? `/wms/sales-orders/${orderId}`
          : `/wms/sales-orders/by-channel/${orderId.salesChannel}/${orderId.channelOrderId}`;

      const response = await this.executeWithRetry(
        () =>
          firstValueFrom(this.httpService.patch<SalesOrder>(url, updateData)),
        `UPDATE_SALES_ORDER:${identifier}`,
      );

      this.logger.log(`✅ [WMS] 판매주문 수정 성공: ${identifier}`);
      return response.data;
    } catch (error) {
      this.logger.error(
        `❌ [WMS] 판매주문 수정 실패: ${identifier}`,
        error.message,
      );
      throw error;
    }
  }

  /**
   * 판매주문 확정
   *
   * @param orderId 주문 식별자
   * @returns 확정된 주문 정보
   */
  async confirmSalesOrder(
    orderId: string | { salesChannel: string; channelOrderId: string },
  ): Promise<SalesOrder> {
    const identifier =
      typeof orderId === 'string'
        ? orderId
        : `${orderId.salesChannel}:${orderId.channelOrderId}`;

    this.logger.log(`✅ [WMS] 판매주문 확정 요청: ${identifier}`);

    try {
      const url =
        typeof orderId === 'string'
          ? `/wms/sales-orders/${orderId}/confirm`
          : `/wms/sales-orders/by-channel/${orderId.salesChannel}/${orderId.channelOrderId}/confirm`;

      const response = await this.executeWithRetry(
        () => firstValueFrom(this.httpService.post<SalesOrder>(url)),
        `CONFIRM_SALES_ORDER:${identifier}`,
      );

      this.logger.log(`✅ [WMS] 판매주문 확정 성공: ${identifier}`);
      return response.data;
    } catch (error) {
      this.logger.error(
        `❌ [WMS] 판매주문 확정 실패: ${identifier}`,
        error.message,
      );
      throw error;
    }
  }

  /**
   * 판매주문 취소
   *
   * @param orderId 주문 식별자
   * @param reason 취소 사유 (선택사항)
   * @returns 취소된 주문 정보
   */
  async cancelSalesOrder(
    orderId: string | { salesChannel: string; channelOrderId: string },
    reason?: string,
  ): Promise<SalesOrder> {
    const identifier =
      typeof orderId === 'string'
        ? orderId
        : `${orderId.salesChannel}:${orderId.channelOrderId}`;

    this.logger.log(`❌ [WMS] 판매주문 취소 요청: ${identifier}`, { reason });

    try {
      const url =
        typeof orderId === 'string'
          ? `/wms/sales-orders/${orderId}/cancel`
          : `/wms/sales-orders/by-channel/${orderId.salesChannel}/${orderId.channelOrderId}/cancel`;

      const response = await this.executeWithRetry(
        () =>
          firstValueFrom(this.httpService.post<SalesOrder>(url, { reason })),
        `CANCEL_SALES_ORDER:${identifier}`,
      );

      this.logger.log(`✅ [WMS] 판매주문 취소 성공: ${identifier}`);
      return response.data;
    } catch (error) {
      this.logger.error(
        `❌ [WMS] 판매주문 취소 실패: ${identifier}`,
        error.message,
      );
      throw error;
    }
  }

  /**
   * 판매주문 조회
   *
   * @param orderId 주문 식별자
   * @returns 주문 정보
   */
  async getSalesOrder(
    orderId: string | { salesChannel: string; channelOrderId: string },
  ): Promise<SalesOrder> {
    const identifier =
      typeof orderId === 'string'
        ? orderId
        : `${orderId.salesChannel}:${orderId.channelOrderId}`;

    try {
      const url =
        typeof orderId === 'string'
          ? `/wms/sales-orders/${orderId}`
          : `/wms/sales-orders/by-channel/${orderId.salesChannel}/${orderId.channelOrderId}`;

      const response = await this.executeWithRetry(
        () => firstValueFrom(this.httpService.get<SalesOrder>(url)),
        `GET_SALES_ORDER:${identifier}`,
      );

      return response.data;
    } catch (error) {
      this.logger.error(
        `❌ [WMS] 판매주문 조회 실패: ${identifier}`,
        error.message,
      );
      throw error;
    }
  }

  /**
   * 재고 가용성 조회
   *
   * @param sku 상품 SKU
   * @param warehouseId 창고 ID (선택사항)
   * @returns 가용 재고 정보
   */
  async getStockAvailability(
    sku: string,
    warehouseId?: string,
  ): Promise<AvailabilityResult> {
    try {
      const params = warehouseId ? { sku, warehouseId } : { sku };

      const response = await this.executeWithRetry(
        () =>
          firstValueFrom(
            this.httpService.get<AvailabilityResult>(
              '/wms/inventory/availability',
              { params },
            ),
          ),
        `GET_AVAILABILITY:${sku}`,
      );

      return response.data;
    } catch (error) {
      this.logger.error(
        `❌ [WMS] 재고 가용성 조회 실패: ${sku}`,
        error.message,
      );
      throw error;
    }
  }

  /**
   * 재시도 로직을 포함한 HTTP 요청 실행
   *
   * @param requestFn HTTP 요청 함수
   * @param operationId 작업 식별자 (DLQ용)
   * @returns HTTP 응답
   */
  private async executeWithRetry<T>(
    requestFn: () => Promise<AxiosResponse<T>>,
    operationId: string,
  ): Promise<AxiosResponse<T>> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await requestFn();

        // 첫 번째 시도가 아닌 경우 복구 로그
        if (attempt > 1) {
          this.logger.log(
            `🔄 [WMS] 재시도 성공: ${operationId} (${attempt}/${this.maxRetries})`,
          );
        }

        return response;
      } catch (error) {
        lastError = error as Error;

        this.logger.warn(
          `⚠️ [WMS] 요청 실패 (${attempt}/${this.maxRetries}): ${operationId}`,
          {
            error: error.message,
            status: error.response?.status,
            attempt,
          },
        );

        // 마지막 시도가 아닌 경우 대기
        if (attempt < this.maxRetries) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // 지수 백오프 (최대 10초)
          await this.sleep(backoffMs);
        }
      }
    }

    // 모든 재시도 실패 시 DLQ 처리
    if (lastError) {
      await this.dlqMonitoring.recordDlqEntry(
        operationId,
        { operation: operationId },
        lastError,
        { maxRetries: this.maxRetries },
      );
      throw lastError;
    }

    // 이 코드는 실행되지 않지만 타입스크립트를 위해 필요
    throw new Error(`Unknown error in ${operationId}`);
  }

  /**
   * 지정된 시간만큼 대기
   *
   * @param ms 대기 시간 (밀리초)
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * WMS 서비스 상태 확인
   *
   * @returns 헬스체크 결과
   */
  async healthCheck(): Promise<{ status: string; timestamp: string }> {
    try {
      const response = await firstValueFrom(
        this.httpService.get('/health', { timeout: 5000 }),
      );

      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.warn('⚠️ [WMS] 헬스체크 실패', error.message);
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
      };
    }
  }
}

// ===== 타입 정의 =====

/**
 * 판매주문 생성 DTO
 */
export interface CreateSalesOrderDto {
  channelOrderId: string;
  salesChannel: string;
  customer?: {
    name?: string;
    email?: string;
    phone?: string;
  };
  shippingAddress: any; // WMS의 주소 형식에 맞춤
  shippingAddressHash?: string;
  totalAmount?: number;
  shippingFee?: number;
  mergeGroupId?: string;
  orderDate?: string;
  lines: Array<{
    variantId: string;
    productMatchingId?: string;
    productName?: string;
    quantity: number;
    unitPrice?: number;
    totalPrice?: number;
  }>;
}

/**
 * 판매주문 수정 DTO
 */
export interface UpdateSalesOrderDto {
  customer?: {
    name?: string;
    email?: string;
    phone?: string;
  };
  shippingAddress?: any;
  totalAmount?: number;
  shippingFee?: number;
  processedAt?: string;
}

/**
 * WMS 판매주문 응답 타입
 */
export interface SalesOrder {
  id: string;
  channelOrderId: string;
  salesChannel: string;
  status: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  shippingAddress: any;
  totalAmount?: number;
  shippingFee: number;
  orderDate: string;
  confirmedAt?: string;
  processedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 재고 가용성 조회 결과
 */
export interface AvailabilityResult {
  sku: string;
  warehouseId?: string;
  availableQuantity: number;
  onHandQuantity: number;
  reservedQuantity: number;
  incomingQuantity?: number;
  lastUpdatedAt: string;
}
