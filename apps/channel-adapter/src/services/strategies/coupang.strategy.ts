import { Injectable } from '@nestjs/common';
import { ChannelStrategy } from './channel-strategy.interface';
import { DataType, SyncResult, SyncToChannelPayload } from '../../types';
import { InternalOrderEvent, OrderQuery } from '../../types';
import { ChannelCommand } from '../../types';
import { CoupangApiService } from '../apis/coupang.api.service';
import {
  CoupangOrderSheet,
  CoupangDeliveryHistoryResponse,
  validateCoupangDateRange,
  mapCoupangStatusToInternal,
} from '../../zods/coupang.api.zod';

@Injectable()
export class CoupangStrategy implements ChannelStrategy {
  constructor(private readonly coupangApiService: CoupangApiService) {}

  async processIncomingEvent(event: any): Promise<InternalOrderEvent[]> {
    // 쿠팡 웹훅이 있는 경우 payload -> InternalOrderEvent로 변환
    return this.transformToInternal(event, 'orders');
  }

  async syncFromChannel(dataType: DataType): Promise<InternalOrderEvent[]> {
    if (dataType !== 'orders') {
      console.log(`Skipping unsupported dataType: ${dataType}`);
      return [];
    }

    try {
      // 1. API 서비스를 통한 조회 (환경변수 체크는 API 서비스에서 처리)

      // 2. 조회 기간 설정 (현재는 24시간 전으로 설정)
      // TODO: 실제 구현에서는 Redis나 DB에서 마지막 동기화 시각을 관리해야 함
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const createdAtFrom = `${yesterday.toISOString().split('T')[0]}+09:00`;
      const createdAtTo = `${now.toISOString().split('T')[0]}+09:00`;

      console.log(
        `📡 쿠팡 발주서 목록 조회 시작 (${createdAtFrom} ~ ${createdAtTo})`,
      );

      // 3. 날짜 범위 검증
      if (!validateCoupangDateRange(createdAtFrom, createdAtTo)) {
        throw new Error('조회 기간이 31일을 초과할 수 없습니다');
      }

      // 4. 모든 상태의 발주서를 조회 (상태별로 분리 조회) - API 서비스 사용
      const statuses = [
        'ACCEPT',
        'INSTRUCT',
        'DEPARTURE',
        'DELIVERING',
        'FINAL_DELIVERY',
      ] as const;
      const allOrderSheets: CoupangOrderSheet[] = [];

      for (const status of statuses) {
        console.log(`📋 ${status} 상태 발주서 조회 중...`);

        const orderSheets =
          await this.coupangApiService.getAllOrderSheetsByStatus(
            createdAtFrom,
            createdAtTo,
            status,
          );

        allOrderSheets.push(...orderSheets);
        console.log(`✅ ${status} 상태: ${orderSheets.length}건 조회됨`);
      }

      console.log(`📊 총 ${allOrderSheets.length}건의 발주서 조회 완료`);

      if (allOrderSheets.length === 0) {
        return [];
      }

      // 5. 쿠팡 발주서를 InternalOrderEvent로 변환
      const events = this.transformCoupangOrderSheetsToInternal(
        allOrderSheets,
        dataType,
      );

      // 6. 디버깅을 위한 첫 번째 발주서 출력
      if (allOrderSheets.length > 0) {
        console.log('🔍 첫 번째 발주서 원본 데이터:');
        console.log(JSON.stringify(allOrderSheets[0], null, 2));
      }

      // 7. TODO: Redis 중복검사 추가 예정
      // 8. TODO: Kafka/이벤트브로커 발행 추가 예정

      return events;
    } catch (error) {
      console.error('❌ 쿠팡 발주서 동기화 실패:', error);
      throw new Error(`쿠팡 발주서 동기화 실패: ${error.message}`);
    }
  }

  /**
   * 🔍 쿠팡 발주서 단건 조회 (shipmentBoxId 기준) - findOrders에서 사용
   */
  private async getSingleOrderSheet(
    shipmentBoxId: string | number,
  ): Promise<InternalOrderEvent> {
    try {
      console.log(`🔍 쿠팡 발주서 단건 조회 시작: ${shipmentBoxId}`);

      // 1. API 서비스를 통한 단건 조회 (네이버 스타일)
      const response =
        await this.coupangApiService.getSingleOrderSheet(shipmentBoxId);

      console.log(`✅ 쿠팡 발주서 단건 조회 성공: ${shipmentBoxId}`);

      // 2. 쿠팡 발주서를 InternalOrderEvent로 변환
      const internalEvent = this.transformSingleCoupangOrderSheetToInternal(
        response.data,
      );

      // 3. 중요한 정보 로깅 (배송지 변경 확인용)
      console.log(
        `📍 수취인 정보: ${internalEvent.buyer?.name} (${internalEvent.buyer?.contact})`,
      );
      console.log(
        `📍 배송지: ${internalEvent.buyer?.address?.roadAddress} ${internalEvent.buyer?.address?.detailAddress}`,
      );

      return internalEvent;
    } catch (error) {
      console.error(`❌ 쿠팡 발주서 단건 조회 실패 (${shipmentBoxId}):`, error);
      throw new Error(`쿠팡 발주서 단건 조회 실패: ${error.message}`);
    }
  }

  async syncToChannel(payload: SyncToChannelPayload): Promise<SyncResult> {
    try {
      switch (payload.dataType) {
        case 'products': {
          const productData = payload.payload;
          console.log(
            `📦 쿠팡 상품 정보 동기화: ${productData.name} (${productData.id})`,
          );

          // TODO: 쿠팡 상품 업데이트 API 구현
          return {
            success: true,
            processedCount: 1,
            data: { productId: productData.id, syncType: 'product_update' },
          };
        }

        case 'inventory': {
          const inventoryData = payload.payload;
          console.log(
            `📦 쿠팡 재고 정보 동기화: ${inventoryData.productId} (${inventoryData.stockQuantity}개)`,
          );

          // TODO: 쿠팡 재고 업데이트 API 구현
          return {
            success: true,
            processedCount: 1,
            data: {
              productId: inventoryData.productId,
              syncType: 'inventory_update',
            },
          };
        }

        case 'order_status': {
          const orderStatusData = payload.payload;
          console.log(
            `📦 쿠팡 주문 상태 동기화: ${orderStatusData.orderId} → ${orderStatusData.status}`,
          );

          // TODO: 쿠팡 주문 상태 업데이트 API 구현
          return {
            success: true,
            processedCount: 1,
            data: {
              orderId: orderStatusData.orderId,
              syncType: 'order_status_update',
            },
          };
        }

        default: {
          const _exhaustiveCheck: never = payload;
          return {
            success: false,
            errors: [{ message: '지원하지 않는 데이터 타입' }],
          };
        }
      }
    } catch (error) {
      return {
        success: false,
        errors: [{ message: `쿠팡 동기화 실패: ${error.message}` }],
        failedCount: 1,
      };
    }
  }

  async executeCommand(command: ChannelCommand): Promise<SyncResult> {
    const accessKey = process.env.COUPANG_ACCESS_KEY;
    const secretKey = process.env.COUPANG_SECRET_KEY;
    const api = process.env.COUPANG_API_ENDPOINT;

    switch (command.type) {
      case 'cancel.approve':
        // 쿠팡 취소 승인 API 호출
        return { success: true };
      case 'dispatch.confirm':
        // 쿠팡 발송 처리 API 호출
        return { success: true };
      // …기타 명령
      default:
        throw new Error(
          `Unsupported command type for Coupang: ${command.type}`,
        );
    }
  }

  async transformToInternal(
    externalData: any,
    dataType: DataType,
  ): Promise<InternalOrderEvent[]> {
    // TODO: 외부 응답 → InternalOrderEvent[] 매핑
    return [];
  }

  async transformToExternal(
    internalData: any,
    dataType: DataType,
  ): Promise<any> {
    return {};
  }

  /**
   * 🔍 쿠팡 발주서 단건 조회 (orderId 기준) - findOrders에서 사용
   */
  private async getSingleOrderSheetByOrderId(
    orderId: string | number,
  ): Promise<InternalOrderEvent[]> {
    try {
      console.log(`🔍 쿠팡 발주서 단건 조회 (orderId) 시작: ${orderId}`);

      // 1. API 서비스를 통한 단건 조회 (네이버 스타일)
      const response =
        await this.coupangApiService.getSingleOrderSheetByOrderId(orderId);

      console.log(
        `✅ 쿠팡 발주서 단건 조회 (orderId) 성공: ${orderId} (${response.data?.length || 0}건)`,
      );

      // 2. 쿠팡 발주서들을 InternalOrderEvent 배열로 변환
      const internalEvents = this.transformCoupangOrderSheetsToInternal(
        response.data,
        'orders',
      );

      // 3. 중요한 정보 로깅 (배송지 변경 확인용)
      if (internalEvents.length > 0) {
        const firstEvent = internalEvents[0];
        console.log(
          `📍 수취인 정보: ${firstEvent.buyer?.name} (${firstEvent.buyer?.contact})`,
        );
        console.log(
          `📍 배송지: ${firstEvent.buyer?.address?.roadAddress} ${firstEvent.buyer?.address?.detailAddress}`,
        );
        console.log(`📦 총 발주서 수: ${internalEvents.length}건`);
      }

      return internalEvents;
    } catch (error) {
      console.error(
        `❌ 쿠팡 발주서 단건 조회 (orderId) 실패 (${orderId}):`,
        error,
      );
      throw new Error(`쿠팡 발주서 단건 조회 (orderId) 실패: ${error.message}`);
    }
  }

  /**
   * 표준화된 쿼리 객체를 사용하여 주문 정보를 조회합니다.
   * @param query 조회 조건을 담은 표준 쿼리 객체
   * @returns 변환된 내부 주문 이벤트 배열. 결과가 없으면 빈 배열을 반환합니다.
   */
  async findOrders(query: OrderQuery): Promise<InternalOrderEvent[]> {
    try {
      switch (query.by) {
        case 'channelShipmentId':
          // 쿠팡 shipmentBoxId로 단건 조회
          const singleOrder = await this.getSingleOrderSheet(query.id);
          return singleOrder ? [singleOrder] : [];

        case 'channelOrderId':
          // 쿠팡 orderId로 조회 (여러 발주서 반환 가능)
          return await this.getSingleOrderSheetByOrderId(query.id);

        case 'channelProductOrderId':
          // 쿠팡은 productOrderId 개념이 없으므로 빈 배열 반환
          console.warn(
            `쿠팡은 'channelProductOrderId'를 사용한 조회를 지원하지 않습니다.`,
          );
          return [];

        default:
          console.warn(`지원하지 않는 조회 타입입니다: ${(query as any).by}`);
          return [];
      }
    } catch (error) {
      console.error(`쿠팡 주문 조회 실패:`, error);
      return [];
    }
  }

  /**
   * 🔍 쿠팡 배송상태 변경 히스토리 조회
   * @param shipmentBoxId 발주서 ID
   * @returns 배송상태 변경 히스토리 응답
   */
  async getDeliveryHistory(
    shipmentBoxId: string | number,
  ): Promise<CoupangDeliveryHistoryResponse> {
    try {
      console.log(`📋 쿠팡 배송상태 히스토리 조회 시작: ${shipmentBoxId}`);

      // API 서비스를 통한 배송상태 히스토리 조회
      const response =
        await this.coupangApiService.getDeliveryHistory(shipmentBoxId);

      console.log(
        `✅ 쿠팡 배송상태 히스토리 조회 성공: ${shipmentBoxId} (${response.data?.histories?.length || 0}건)`,
      );

      return response;
    } catch (error) {
      console.error(
        `❌ 쿠팡 배송상태 히스토리 조회 실패 (${shipmentBoxId}):`,
        error.message,
      );
      throw new Error(`쿠팡 배송상태 히스토리 조회 실패: ${error.message}`);
    }
  }

  /**
   * 쿠팡 발주서를 InternalOrderEvent로 변환
   */
  private transformCoupangOrderSheetsToInternal(
    orderSheets: CoupangOrderSheet[],
    dataType: DataType,
  ): InternalOrderEvent[] {
    const events: InternalOrderEvent[] = [];

    for (const orderSheet of orderSheets) {
      // 각 주문 상품에 대해 개별 이벤트 생성
      for (const orderItem of orderSheet.orderItems) {
        const internalEvent: InternalOrderEvent = {
          channelType: 'coupang',
          externalOrderId: orderSheet.orderId.toString(),
          externalProductOrderId: orderItem.vendorItemId.toString(),
          status: mapCoupangStatusToInternal(orderSheet.status),
          lastChangedType: 'ORDER_STATUS_CHANGED',
          lastChangedAt: orderSheet.orderedAt,
          paymentDate: orderSheet.paidAt,
          quantity: orderItem.shippingCount,
          priceAmount: orderItem.salesPrice.units,
          createdAt: orderSheet.orderedAt,
          updatedAt: orderSheet.paidAt,

          // 할인 정보
          discountAmount: orderItem.discountPrice.units,

          // 구매자/수취인 정보
          buyer: {
            name: orderSheet.receiver.name,
            contact: orderSheet.receiver.safeNumber,
            address: {
              postalCode: orderSheet.receiver.postCode,
              roadAddress: orderSheet.receiver.addr1,
              detailAddress: orderSheet.receiver.addr2,
            },
          },

          // 배송 정보
          dispatch: orderSheet.invoiceNumber
            ? {
                deliveryMethod: 'DELIVERY',
                deliveryCompanyCode:
                  orderSheet.deliveryCompanyName || 'UNKNOWN',
                trackingNumber: orderSheet.invoiceNumber,
                dispatchedAt: orderSheet.inTrasitDateTime,
              }
            : undefined,
        };

        events.push(internalEvent);
      }
    }

    return events;
  }

  /**
   * 쿠팡 발주서 단건을 InternalOrderEvent로 변환
   *
   * 단건 조회는 배송지 변경 확인이나 실시간 상태 조회에 주로 사용되므로,
   * 첫 번째 주문 상품을 기준으로 대표 이벤트를 생성합니다.
   *
   * @param orderSheet 쿠팡 발주서 단건 데이터
   * @returns 변환된 내부 주문 이벤트
   */
  private transformSingleCoupangOrderSheetToInternal(
    orderSheet: CoupangOrderSheet,
  ): InternalOrderEvent {
    // 첫 번째 주문 상품을 대표로 사용 (단건 조회에서는 주로 전체 주문 정보가 중요)
    const firstOrderItem = orderSheet.orderItems[0];

    if (!firstOrderItem) {
      throw new Error('발주서에 주문 상품이 없습니다');
    }

    const internalEvent: InternalOrderEvent = {
      channelType: 'coupang',
      externalOrderId: orderSheet.orderId.toString(),
      externalProductOrderId: firstOrderItem.vendorItemId.toString(),
      status: mapCoupangStatusToInternal(orderSheet.status),
      lastChangedType: 'SINGLE_ORDER_QUERY', // 단건 조회임을 명시
      lastChangedAt: orderSheet.orderedAt,
      paymentDate: orderSheet.paidAt,
      quantity: firstOrderItem.shippingCount,
      priceAmount: firstOrderItem.salesPrice.units,
      createdAt: orderSheet.orderedAt,
      updatedAt: orderSheet.paidAt,

      // 할인 정보
      discountAmount: firstOrderItem.discountPrice.units,

      // 🎯 배송지 변경 확인을 위한 수취인 정보 (단건 조회의 핵심)
      buyer: {
        name: orderSheet.receiver.name,
        contact: orderSheet.receiver.safeNumber,
        address: {
          postalCode: orderSheet.receiver.postCode,
          roadAddress: orderSheet.receiver.addr1,
          detailAddress: orderSheet.receiver.addr2,
        },
      },

      // 🚚 배송 정보 (운송장 번호, 배송 상태 확인)
      dispatch: orderSheet.invoiceNumber
        ? {
            deliveryMethod: 'DELIVERY',
            deliveryCompanyCode: orderSheet.deliveryCompanyName || 'UNKNOWN',
            trackingNumber: orderSheet.invoiceNumber,
            dispatchedAt: orderSheet.inTrasitDateTime,
          }
        : undefined,
    };

    return internalEvent;
  }
}
