import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AxiosResponse } from 'axios';

@Injectable()
export class WmsApiService {
  private readonly logger = new Logger(WmsApiService.name);
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly maxRetries: number;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.baseUrl = this.configService.get<string>(
      'WMS_API_URL',
      'http://localhost:3001',
    );
    this.timeout = this.configService.get<number>('WMS_TIMEOUT', 10000);
    this.maxRetries = this.configService.get<number>('WMS_MAX_RETRIES', 3);

    this.httpService.axiosRef.defaults.timeout = this.timeout;
    this.httpService.axiosRef.defaults.baseURL = this.baseUrl;

    this.logger.log(`🏭 WMS API 클라이언트 초기화 완료 (${this.baseUrl})`);
  }

  /** 판매주문 생성 */
  async createSalesOrder(orderData: CreateSalesOrderDto): Promise<SalesOrder> {
    const startTime = Date.now();
    const identifier = `${orderData.salesChannel}:${orderData.channelOrderId}`;

    this.logger.log(`📝 [WMS] 판매주문 생성 요청: ${identifier}`);

    try {
      const response = await this.executeWithRetry(
        () =>
          firstValueFrom(
            this.httpService.post<SalesOrder>('/wms/sales-orders', orderData),
          ),
        `CREATE_SALES_ORDER:${identifier}`,
      );

      this.logger.log(
        `✅ [WMS] 판매주문 생성 성공: ${identifier} (${Date.now() - startTime}ms)`,
      );

      return response.data;
    } catch (error) {
      this.logger.error(
        `❌ [WMS] 판매주문 생성 실패: ${identifier}`,
        error.message,
      );
      throw error;
    }
  }

  /** 판매주문 조회 */
  async getSalesOrder(order: ChannelOrderRef): Promise<SalesOrder> {
    const identifier = `${order.salesChannel}:${order.channelOrderId}`;
    const url = `/wms/sales-orders/${encodeURIComponent(
      order.salesChannel,
    )}/${encodeURIComponent(order.channelOrderId)}`;

    this.logger.debug(`🔍 [WMS] 판매주문 조회 요청: ${identifier}`);

    try {
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

  /** 판매주문 수정 */
  async updateSalesOrder(
    order: ChannelOrderRef,
    updateData: UpdateSalesOrderDto,
  ): Promise<SalesOrder> {
    const identifier = `${order.salesChannel}:${order.channelOrderId}`;
    const url = `/wms/sales-orders/${encodeURIComponent(
      order.salesChannel,
    )}/${encodeURIComponent(order.channelOrderId)}`;

    this.logger.log(`📝 [WMS] 판매주문 수정 요청: ${identifier}`);

    try {
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

  /** 판매주문 확정 */
  async confirmSalesOrder(order: ChannelOrderRef): Promise<SalesOrder> {
    const identifier = `${order.salesChannel}:${order.channelOrderId}`;
    const url = `/wms/sales-orders/${encodeURIComponent(
      order.salesChannel,
    )}/${encodeURIComponent(order.channelOrderId)}/confirm`;

    this.logger.log(`✅ [WMS] 판매주문 확정 요청: ${identifier}`);

    try {
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

  /** 판매주문 취소 */
  async cancelSalesOrder(
    order: ChannelOrderRef,
    reason?: string,
  ): Promise<SalesOrder> {
    const identifier = `${order.salesChannel}:${order.channelOrderId}`;
    const url = `/wms/sales-orders/${encodeURIComponent(
      order.salesChannel,
    )}/${encodeURIComponent(order.channelOrderId)}/cancel`;

    this.logger.log(`❌ [WMS] 판매주문 취소 요청: ${identifier}`, { reason });

    try {
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

  /** 재고 가용성 조회 */
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

  /** 재시도 로직 */
  private async executeWithRetry<T>(
    requestFn: () => Promise<AxiosResponse<T>>,
    operationId: string,
  ): Promise<AxiosResponse<T>> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await requestFn();

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
            error: (error as any).message,
            status: (error as any).response?.status,
            attempt,
          },
        );

        if (attempt < this.maxRetries) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          await this.sleep(backoffMs);
        }
      }
    }

    if (lastError) {
      // NOTE: DlqMonitoringService 제거됨 (메모리 기반 MVP 코드였음)
      // WMS API 호출 실패 시 DLQ 처리가 필요하다면 @app/events 기반으로 구현 권장
      throw lastError;
    }

    throw new Error(`Unknown error in ${operationId}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** 헬스체크 */
  async healthCheck(): Promise<{ status: string; timestamp: string }> {
    try {
      await firstValueFrom(this.httpService.get('/health', { timeout: 5000 }));

      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.warn('⚠️ [WMS] 헬스체크 실패', (error as any).message);
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
      };
    }
  }
}

/** ===== 타입 정의 ===== */

export interface ChannelOrderRef {
  salesChannel: string;
  channelOrderId: string;
}

export interface CreateSalesOrderDto extends ChannelOrderRef {
  customer?: {
    name?: string;
    email?: string;
    phone?: string;
  };
  shippingAddress: any;
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

export interface AvailabilityResult {
  sku: string;
  warehouseId?: string;
  availableQuantity: number;
  onHandQuantity: number;
  reservedQuantity: number;
  incomingQuantity?: number;
  lastUpdatedAt: string;
}
