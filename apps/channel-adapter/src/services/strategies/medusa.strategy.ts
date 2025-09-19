import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ChannelStrategy } from './channel-strategy.interface';
import {
  DataType,
  SyncResult,
  SyncToChannelPayload,
  InternalInventoryData,
} from '../../types';
import { InternalOrderEvent } from '../../types';
import { ChannelCommand } from '../../types';
import { firstValueFrom } from 'rxjs';

/**
 * 메두사(자사몰) 채널 전략
 *
 * 메두사는 우리의 자사몰이므로 주로 다음 역할을 담당합니다:
 * 1. 자사몰에서 발생한 주문을 수집하여 내부 표준 이벤트로 변환 (syncFromChannel)
 * 2. 메두사 자체는 SOT이므로 외부로 데이터를 보내는 일은 거의 없음 (syncToChannel은 최소화)
 * 3. 주문 상태 변경이나 재고 조정 등의 명령 처리 (executeCommand)
 *
 * @example
 * ```typescript
 * // 자사몰 주문 수집
 * const orders = await medusaStrategy.syncFromChannel('orders');
 *
 * // 자사몰 주문 상태 업데이트
 * const result = await medusaStrategy.executeCommand({
 *   type: 'order.confirm',
 *   orderId: 'order_123'
 * });
 * ```
 */
@Injectable()
export class MedusaStrategy implements ChannelStrategy {
  private readonly logger = new Logger(MedusaStrategy.name);

  constructor(private readonly http: HttpService) {
    this.logger.log('📦 메두사 전략 초기화 완료');
  }

  /**
   * 메두사에서 수신된 웹훅/이벤트 처리
   *
   * @param event - 메두사에서 전송된 이벤트 데이터
   * @returns 변환된 내부 주문 이벤트 배열
   */
  async processIncomingEvent(event: any): Promise<InternalOrderEvent[]> {
    this.logger.log('📨 메두사 웹훅 이벤트 처리 시작');

    try {
      // 메두사 웹훅 이벤트를 내부 표준 이벤트로 변환
      return this.transformMedusaEventToInternal(event);
    } catch (error) {
      this.logger.error('❌ 메두사 웹훅 이벤트 처리 실패:', error.message);
      throw new Error(`메두사 웹훅 처리 실패: ${error.message}`);
    }
  }

  /**
   * 🔄 수신(Inbound) 동기화: 메두사에서 주문 데이터를 가져와 내부 표준 이벤트로 변환
   *
   * @param dataType - 동기화할 데이터 타입 (주로 'orders')
   * @returns 변환된 내부 주문 이벤트 배열
   */
  async syncFromChannel(dataType: DataType): Promise<InternalOrderEvent[]> {
    if (dataType !== 'orders') {
      this.logger.warn(
        `메두사는 현재 '${dataType}' 동기화를 지원하지 않습니다. 'orders'만 지원됩니다.`,
      );
      return [];
    }

    try {
      this.logger.log('📡 메두사 주문 데이터 동기화 시작');

      // 1. 메두사 Admin API를 통해 최근 주문들 조회
      const recentOrders = await this.fetchRecentOrdersFromMedusa();

      this.logger.log(`📋 메두사에서 ${recentOrders.length}건의 주문 조회됨`);

      if (recentOrders.length === 0) {
        this.logger.log('📭 새로운 주문이 없습니다.');
        return [];
      }

      // 2. 메두사 주문 데이터를 내부 표준 이벤트로 변환
      const internalEvents = recentOrders.map((order) =>
        this.transformMedusaOrderToInternalEvent(order),
      );

      this.logger.log(`🎯 메두사 주문 변환 완료: ${internalEvents.length}건`);
      return internalEvents;
    } catch (error) {
      this.logger.error('❌ 메두사 주문 동기화 실패:', error.message);
      throw new Error(`메두사 주문 동기화 실패: ${error.message}`);
    }
  }

  /**
   * 🔄 송신(Outbound) 동기화: 내부 시스템의 변경사항을 메두사로 전송
   *
   * 메두사는 자사몰이자 SOT이므로 외부로 데이터를 보내는 경우는 제한적입니다.
   * 주로 주문 상태 업데이트나 재고 조정 등의 경우에만 사용됩니다.
   *
   * @param payload - 동기화할 데이터 페이로드
   * @returns 동기화 처리 결과
   */
  async syncToChannel(payload: SyncToChannelPayload): Promise<SyncResult> {
    this.logger.log(`📤 메두사 ${payload.dataType} 송신 동기화 시작`);

    try {
      switch (payload.dataType) {
        case 'order_status': {
          const orderStatusData = payload.payload;
          this.logger.log(
            `📦 메두사 주문 상태 업데이트: ${orderStatusData.orderId} → ${orderStatusData.status}`,
          );

          // 메두사 Admin API를 통해 주문 상태 업데이트
          await this.updateMedusaOrderStatus(
            orderStatusData.orderId,
            orderStatusData.status,
          );

          return {
            success: true,
            processedCount: 1,
            data: {
              orderId: orderStatusData.orderId,
              syncType: 'order_status_update',
            },
          };
        }

        case 'inventory': {
          const inventoryData = payload.payload;
          this.logger.log(
            `📦 메두사 재고 조정: ${inventoryData.productId} (${inventoryData.stockQuantity}개)`,
          );

          // 메두사는 보통 재고의 SOT이므로 외부에서 재고를 업데이트하는 경우는 드물지만
          // 예외적인 상황(예: 손상품 처리)에서 사용할 수 있습니다.
          await this.adjustMedusaInventory(
            inventoryData.productId,
            inventoryData.stockQuantity,
          );

          return {
            success: true,
            processedCount: 1,
            data: {
              productId: inventoryData.productId,
              syncType: 'inventory_adjustment',
            },
          };
        }

        default: {
          this.logger.warn(
            `메두사는 '${payload.dataType}' 송신 동기화를 지원하지 않습니다.`,
          );
          return {
            success: false,
            errors: [{ message: '지원하지 않는 데이터 타입입니다.' }],
            failedCount: 1,
          };
        }
      }
    } catch (error) {
      this.logger.error(
        `❌ 메두사 ${payload.dataType} 송신 동기화 실패:`,
        error.message,
      );
      return {
        success: false,
        errors: [{ message: `메두사 동기화 실패: ${error.message}` }],
        failedCount: 1,
      };
    }
  }

  /**
   * 메두사 채널에서 명령 실행
   *
   * @param command - 실행할 명령 객체
   * @returns 명령 실행 결과
   */
  async executeCommand(command: ChannelCommand): Promise<SyncResult> {
    this.logger.log(`⚡ 메두사 명령 실행: ${command.type}`);

    try {
      switch (command.type) {
        case 'order.confirm':
          return await this.executeOrderConfirm(command);

        case 'dispatch.confirm':
          return await this.executeDispatchConfirm(command);

        case 'cancel.approve':
          return await this.executeCancelApprove(command);

        default:
          this.logger.warn(
            `메두사는 '${command.type}' 명령을 지원하지 않습니다.`,
          );
          return {
            success: false,
            errors: [{ message: `지원하지 않는 명령 타입: ${command.type}` }],
            failedCount: 1,
          };
      }
    } catch (error) {
      this.logger.error(
        `❌ 메두사 명령 실행 실패: ${command.type}`,
        error.message,
      );
      return {
        success: false,
        errors: [{ message: `메두사 명령 실행 실패: ${error.message}` }],
        failedCount: 1,
      };
    }
  }

  async transformToInternal(
    externalData: any,
    dataType: DataType,
  ): Promise<InternalOrderEvent[]> {
    if (dataType === 'orders' && Array.isArray(externalData)) {
      return externalData.map((order) =>
        this.transformMedusaOrderToInternalEvent(order),
      );
    }
    return [];
  }

  async transformToExternal(
    internalData: any,
    dataType: DataType,
  ): Promise<any> {
    // 메두사는 자사몰이므로 내부 → 외부 변환은 제한적
    this.logger.warn(
      '메두사는 내부 → 외부 변환을 최소화합니다. (자사몰이므로)',
    );
    return internalData;
  }

  // ===== Private Helper Methods =====

  /**
   * 메두사 Admin API를 통해 최근 주문들을 조회
   */
  private async fetchRecentOrdersFromMedusa(): Promise<any[]> {
    try {
      const medusaApiUrl =
        process.env.MEDUSA_API_URL || 'http://localhost:9000';
      const adminApiKey = process.env.MEDUSA_ADMIN_API_KEY;

      if (!adminApiKey) {
        throw new Error(
          'MEDUSA_ADMIN_API_KEY 환경 변수가 설정되지 않았습니다.',
        );
      }

      // 지난 24시간 동안의 주문 조회
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const response = await firstValueFrom(
        this.http.get(`${medusaApiUrl}/admin/orders`, {
          headers: {
            Authorization: `Bearer ${adminApiKey}`,
            'Content-Type': 'application/json',
          },
          params: {
            created_at: { gte: since },
            limit: 100, // 최대 100건
          },
        }),
      );

      return response.data?.orders || [];
    } catch (error) {
      this.logger.error(
        '메두사 주문 조회 API 호출 실패:',
        error.response?.data || error.message,
      );
      throw new Error(`메두사 주문 조회 실패: ${error.message}`);
    }
  }

  /**
   * 메두사 주문 데이터를 내부 표준 이벤트로 변환
   */
  private transformMedusaOrderToInternalEvent(
    medusaOrder: any,
  ): InternalOrderEvent {
    return {
      channelType: 'medusa', // 자사몰 채널 타입 추가 필요
      externalOrderId: medusaOrder.id,
      externalProductOrderId: medusaOrder.id, // 메두사는 주문 단위가 동일
      status: this.mapMedusaStatusToInternal(medusaOrder.status),
      paymentDate: medusaOrder.created_at,
      quantity:
        medusaOrder.items?.reduce(
          (sum: number, item: any) => sum + item.quantity,
          0,
        ) || 1,
      priceAmount: medusaOrder.total || 0,
      discountAmount: medusaOrder.discount_total || 0,
      buyer: {
        name:
          medusaOrder.shipping_address?.first_name +
          ' ' +
          medusaOrder.shipping_address?.last_name,
        contact: medusaOrder.shipping_address?.phone,
        address: {
          postalCode: medusaOrder.shipping_address?.postal_code,
          roadAddress: medusaOrder.shipping_address?.address_1,
          detailAddress: medusaOrder.shipping_address?.address_2,
        },
      },
      createdAt: medusaOrder.created_at,
      updatedAt: medusaOrder.updated_at,
    };
  }

  /**
   * 메두사 웹훅 이벤트를 내부 표준 이벤트로 변환
   */
  private transformMedusaEventToInternal(event: any): InternalOrderEvent[] {
    // 메두사 웹훅 이벤트 타입에 따른 변환 로직
    switch (event.type) {
      case 'order.placed':
      case 'order.updated':
        return [this.transformMedusaOrderToInternalEvent(event.data)];

      default:
        this.logger.warn(`알 수 없는 메두사 웹훅 이벤트 타입: ${event.type}`);
        return [];
    }
  }

  /**
   * 메두사 주문 상태를 내부 표준 상태로 매핑
   */
  private mapMedusaStatusToInternal(medusaStatus: string): string {
    const statusMap: Record<string, string> = {
      pending: 'PENDING_PAYMENT',
      completed: 'PAID',
      shipped: 'SHIPPED',
      delivered: 'DELIVERED',
      canceled: 'CANCELLED',
      returned: 'RETURNED',
    };
    return statusMap[medusaStatus] || medusaStatus;
  }

  /**
   * 메두사 주문 상태 업데이트
   */
  private async updateMedusaOrderStatus(
    orderId: string,
    status: string,
  ): Promise<void> {
    try {
      const medusaApiUrl =
        process.env.MEDUSA_API_URL || 'http://localhost:9000';
      const adminApiKey = process.env.MEDUSA_ADMIN_API_KEY;

      await firstValueFrom(
        this.http.post(
          `${medusaApiUrl}/admin/orders/${orderId}`,
          { status },
          {
            headers: {
              Authorization: `Bearer ${adminApiKey}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      this.logger.log(
        `✅ 메두사 주문 상태 업데이트 성공: ${orderId} → ${status}`,
      );
    } catch (error) {
      this.logger.error(
        `❌ 메두사 주문 상태 업데이트 실패: ${orderId}`,
        error.response?.data || error.message,
      );
      throw new Error(`메두사 주문 상태 업데이트 실패: ${error.message}`);
    }
  }

  /**
   * 메두사 재고 조정
   */
  private async adjustMedusaInventory(
    productId: string,
    quantity: number,
  ): Promise<void> {
    try {
      const medusaApiUrl =
        process.env.MEDUSA_API_URL || 'http://localhost:9000';
      const adminApiKey = process.env.MEDUSA_ADMIN_API_KEY;

      // 메두사의 재고 조정 API 호출 (실제 API 스펙에 따라 조정 필요)
      await firstValueFrom(
        this.http.post(
          `${medusaApiUrl}/admin/products/${productId}/variants/inventory`,
          { quantity },
          {
            headers: {
              Authorization: `Bearer ${adminApiKey}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      this.logger.log(`✅ 메두사 재고 조정 성공: ${productId} → ${quantity}개`);
    } catch (error) {
      this.logger.error(
        `❌ 메두사 재고 조정 실패: ${productId}`,
        error.response?.data || error.message,
      );
      throw new Error(`메두사 재고 조정 실패: ${error.message}`);
    }
  }

  // 명령 실행 헬퍼 메서드들
  private async executeOrderConfirm(command: any): Promise<SyncResult> {
    this.logger.log(
      `✅ 메두사 발주확인: ${command.orderId || command.productOrderIds?.join(', ')}`,
    );

    // 메두사에서는 발주확인이 자동으로 처리되므로 성공으로 반환
    return {
      success: true,
      processedCount: 1,
      data: { message: '메두사에서는 발주확인이 자동 처리됩니다.' },
    };
  }

  private async executeDispatchConfirm(command: any): Promise<SyncResult> {
    this.logger.log(`📦 메두사 발송처리: ${command.orderId}`);

    try {
      // 메두사 주문을 'shipped' 상태로 업데이트
      await this.updateMedusaOrderStatus(command.orderId, 'shipped');

      return {
        success: true,
        processedCount: 1,
        data: { orderId: command.orderId, status: 'shipped' },
      };
    } catch (error) {
      return {
        success: false,
        errors: [{ id: command.orderId, message: error.message }],
        failedCount: 1,
      };
    }
  }

  private async executeCancelApprove(command: any): Promise<SyncResult> {
    this.logger.log(
      `❌ 메두사 취소승인: ${command.orderId || command.claimId}`,
    );

    try {
      const orderId = command.orderId || command.claimId;
      await this.updateMedusaOrderStatus(orderId, 'canceled');

      return {
        success: true,
        processedCount: 1,
        data: { orderId, status: 'canceled' },
      };
    } catch (error) {
      return {
        success: false,
        errors: [
          { id: command.orderId || command.claimId, message: error.message },
        ],
        failedCount: 1,
      };
    }
  }
}
