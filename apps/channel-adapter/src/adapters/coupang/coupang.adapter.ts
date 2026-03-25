import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ChannelAdapter } from '../channel-adapter.interface';
import { DataType, SyncResult, SyncToChannelPayload } from '../../types';
import { InternalOrderEvent, InternalExchangeEvent, InternalReturnEvent, OrderQuery } from '../../types';
import { ChannelCommand, ChannelQuery } from '../../types';
import { CoupangOrderClient, CoupangReturnClient, CoupangExchangeClient } from './clients';
import {
  CoupangOrderSheet,
  CoupangDeliveryHistoryResponse,
  CoupangExchangeRequest,
  validateCoupangDateRange,
  mapCoupangStatusToInternal,
} from '../../zods/coupang';
import { OrderEventPublisher } from '../../services/order-event.publisher';
import { PendingOrderService } from '../../services/pending-order.service';

/**
 * 쿠팡 채널 어댑터
 *
 * 쿠팡 API의 특수한 인터페이스를 내부 표준 인터페이스로 변환합니다.
 * 어댑터 패턴을 적용하여 쿠팡 API 호출 방식을 내부 시스템에 적응시킵니다.
 */
@Injectable()
export class CoupangAdapter implements ChannelAdapter {
  private readonly logger = new Logger(CoupangAdapter.name);

  constructor(
    private readonly coupangOrderClient: CoupangOrderClient,
    private readonly coupangReturnClient: CoupangReturnClient,
    private readonly coupangExchangeClient: CoupangExchangeClient,
    private readonly orderEventPublisher: OrderEventPublisher,
    private readonly pendingOrderService: PendingOrderService,
  ) {}

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

      console.log(`📡 쿠팡 발주서 목록 조회 시작 (${createdAtFrom} ~ ${createdAtTo})`);

      // 3. 날짜 범위 검증
      if (!validateCoupangDateRange(createdAtFrom, createdAtTo)) {
        throw new Error('조회 기간이 31일을 초과할 수 없습니다');
      }

      // 4. 모든 상태의 발주서를 조회 (상태별로 분리 조회) - API 서비스 사용
      const statuses = ['ACCEPT', 'INSTRUCT', 'DEPARTURE', 'DELIVERING', 'FINAL_DELIVERY'] as const;
      const allOrderSheets: CoupangOrderSheet[] = [];

      for (const status of statuses) {
        console.log(`📋 ${status} 상태 발주서 조회 중...`);

        const orderSheets = await this.coupangOrderClient.getAllOrderSheetsByStatus(createdAtFrom, createdAtTo, status);

        allOrderSheets.push(...orderSheets);
        console.log(`✅ ${status} 상태: ${orderSheets.length}건 조회됨`);
      }

      console.log(`📊 총 ${allOrderSheets.length}건의 발주서 조회 완료`);

      if (allOrderSheets.length === 0) {
        return [];
      }

      // 5. 쿠팡 발주서를 InternalOrderEvent로 변환
      const events = this.transformCoupangOrderSheetsToInternal(allOrderSheets, dataType);

      // 6. 디버깅을 위한 첫 번째 발주서 출력
      if (allOrderSheets.length > 0) {
        console.log('🔍 첫 번째 발주서 원본 데이터:');
        console.log(JSON.stringify(allOrderSheets[0], null, 2));
      }

      // 7. 주문 이벤트 발행 (WMS로 전달)
      await this.publishOrderEvents(events);

      return events;
    } catch (error) {
      console.error('❌ 쿠팡 발주서 동기화 실패:', error);
      throw new Error(`쿠팡 발주서 동기화 실패: ${error.message}`);
    }
  }

  /**
   * 🔍 쿠팡 발주서 단건 조회 (shipmentBoxId 기준) - findOrders에서 사용
   */
  private async getSingleOrderSheet(shipmentBoxId: string | number): Promise<InternalOrderEvent> {
    try {
      console.log(`🔍 쿠팡 발주서 단건 조회 시작: ${shipmentBoxId}`);

      // 1. API 서비스를 통한 단건 조회 (네이버 스타일)
      const response = await this.coupangOrderClient.getSingleOrderSheet(shipmentBoxId);

      console.log(`✅ 쿠팡 발주서 단건 조회 성공: ${shipmentBoxId}`);

      // 2. 쿠팡 발주서를 InternalOrderEvent로 변환
      const internalEvent = this.transformSingleCoupangOrderSheetToInternal(response.data);

      // 3. 중요한 정보 로깅 (배송지 변경 확인용)
      console.log(`📍 수취인 정보: ${internalEvent.buyer?.name} (${internalEvent.buyer?.contact})`);
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
          console.log(`📦 쿠팡 상품 정보 동기화: ${productData.name} (${productData.id})`);

          // TODO: 쿠팡 상품 업데이트 API 구현
          return {
            success: true,
            processedCount: 1,
            data: { productId: productData.id, syncType: 'product_update' },
          };
        }

        case 'inventory': {
          const inventoryData = payload.payload;
          console.log(`📦 쿠팡 재고 정보 동기화: ${inventoryData.productId} (${inventoryData.stockQuantity}개)`);

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
          console.log(`📦 쿠팡 주문 상태 동기화: ${orderStatusData.orderId} → ${orderStatusData.status}`);

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
    try {
      // 🔍 입력 명령 유효성 검증 (네이버 패턴과 동일)
      const validationResult = this.validateStandardCommand(command);
      if (!validationResult.success) {
        return {
          success: false,
          errors: validationResult.errors.map((err) => ({
            message: `명령 검증 실패: ${err.message}`,
          })),
          failedCount: 1,
        };
      }

      switch (command.type) {
        case 'order.prepare':
          return await this.executeOrderPrepare(command);

        case 'dispatch.ship':
          return await this.executeDispatchShip(command);

        case 'dispatch.update_tracking':
          return await this.executeDispatchUpdateTracking(command);

        case 'return.approve':
          return await this.executeReturnApprove(command);

        case 'return.confirm_receipt':
          return await this.executeReturnConfirmReceipt(command);

        case 'return.process_shipment_stop':
          return await this.executeReturnProcessShipmentStop(command);

        case 'return.process_already_shipped':
          return await this.executeReturnProcessAlreadyShipped(command);

        case 'return.register_collection_invoice':
          return await this.executeReturnRegisterCollectionInvoice(command);

        case 'exchange.confirm_receipt':
          return await this.executeExchangeConfirmReceipt(command);

        case 'exchange.reject':
          return await this.executeExchangeReject(command);

        case 'exchange.upload_invoice':
          return await this.executeExchangeUploadInvoice(command);

        default:
          return {
            success: false,
            errors: [{ message: `쿠팡에서 지원하지 않는 명령: ${command.type}` }],
            failedCount: 1,
          };
      }
    } catch (error) {
      console.error('❌ 쿠팡 명령 실행 중 예외 발생:', error);
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        errors: [{ message: `쿠팡 명령 실행 실패: ${message}` }],
        failedCount: 1,
      };
    }
  }

  async executeQuery(query: ChannelQuery): Promise<any> {
    try {
      switch (query.type) {
        case 'delivery.history':
          return await this.queryDeliveryHistory(query);

        case 'return.withdrawal_history':
          return await this.queryReturnWithdrawalHistory(query);

        case 'return.withdrawal_history_by_claims':
          return await this.queryReturnWithdrawalHistoryByClaims(query);

        case 'exchange.requests':
          return await this.queryExchangeRequests(query);

        default:
          throw new Error(`쿠팡에서 지원하지 않는 조회: ${query.type}`);
      }
    } catch (error) {
      // 🎯 BadRequestException은 그대로 전달하여 컨트롤러에서 처리할 수 있도록 함
      if (error instanceof BadRequestException) {
        throw error; // BadRequestException은 그대로 전달
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`쿠팡 조회 실행 실패: ${message}`);
    }
  }

  async transformToInternal(externalData: any, dataType: DataType): Promise<InternalOrderEvent[]> {
    // TODO: 외부 응답 → InternalOrderEvent[] 매핑
    return [];
  }

  async transformToExternal(internalData: any, dataType: DataType): Promise<any> {
    return {};
  }

  /**
   * 🔍 쿠팡 발주서 단건 조회 (orderId 기준) - findOrders에서 사용
   */
  private async getSingleOrderSheetByOrderId(orderId: string | number): Promise<InternalOrderEvent[]> {
    try {
      console.log(`🔍 쿠팡 발주서 단건 조회 (orderId) 시작: ${orderId}`);

      // 1. API 서비스를 통한 단건 조회 (네이버 스타일)
      const response = await this.coupangOrderClient.getSingleOrderSheetByOrderId(orderId);

      console.log(`✅ 쿠팡 발주서 단건 조회 (orderId) 성공: ${orderId} (${response.data?.length || 0}건)`);

      // 2. 쿠팡 발주서들을 InternalOrderEvent 배열로 변환
      const internalEvents = this.transformCoupangOrderSheetsToInternal(response.data, 'orders');

      // 3. 중요한 정보 로깅 (배송지 변경 확인용)
      if (internalEvents.length > 0) {
        const firstEvent = internalEvents[0];
        console.log(`📍 수취인 정보: ${firstEvent.buyer?.name} (${firstEvent.buyer?.contact})`);
        console.log(`📍 배송지: ${firstEvent.buyer?.address?.roadAddress} ${firstEvent.buyer?.address?.detailAddress}`);
        console.log(`📦 총 발주서 수: ${internalEvents.length}건`);
      }

      return internalEvents;
    } catch (error) {
      console.error(`❌ 쿠팡 발주서 단건 조회 (orderId) 실패 (${orderId}):`, error);
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
          console.warn(`쿠팡은 'channelProductOrderId'를 사용한 조회를 지원하지 않습니다.`);
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
  async getDeliveryHistory(shipmentBoxId: string | number): Promise<CoupangDeliveryHistoryResponse> {
    try {
      console.log(`📋 쿠팡 배송상태 히스토리 조회 시작: ${shipmentBoxId}`);

      // API 서비스를 통한 배송상태 히스토리 조회
      const response = await this.coupangOrderClient.getDeliveryHistory(shipmentBoxId);

      console.log(`✅ 쿠팡 배송상태 히스토리 조회 성공: ${shipmentBoxId} (${response.data?.histories?.length || 0}건)`);

      return response;
    } catch (error) {
      console.error(`❌ 쿠팡 배송상태 히스토리 조회 실패 (${shipmentBoxId}):`, error.message);
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
                deliveryCompanyCode: orderSheet.deliveryCompanyName || 'UNKNOWN',
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
  private transformSingleCoupangOrderSheetToInternal(orderSheet: CoupangOrderSheet): InternalOrderEvent {
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

  // =================================================================
  // == 표준 명령 → 쿠팡 API 번역 메서드들 (Command Translation Methods)
  // =================================================================

  /**
   * 표준 명령: order.prepare → 쿠팡 API: acknowledgeOrdersheets
   * 내부 표준 orderIds를 쿠팡의 shipmentBoxIds로 번역
   */
  private async executeOrderPrepare(command: { type: 'order.prepare'; orderIds: string[] }): Promise<SyncResult> {
    try {
      console.log('📦 쿠팡 주문 준비 처리 실행:', command);

      // 🔄 표준 orderIds → 쿠팡 shipmentBoxIds 번역
      const shipmentBoxIds = await this.translateOrderIdsToShipmentBoxIds(command.orderIds);

      const response = await this.coupangOrderClient.acknowledgeOrdersheets({
        vendorId: this.getCoupangVendorId(),
        shipmentBoxIds,
      });

      return this.transformCoupangResponseToSyncResult(response, 'order.prepare');
    } catch (error) {
      console.error('❌ 쿠팡 주문 준비 처리 실패:', error);
      return {
        success: false,
        errors: [{ message: `주문 준비 처리 실패: ${error.message}` }],
        failedCount: 1,
      };
    }
  }

  /**
   * 표준 명령: dispatch.ship → 쿠팡 API: uploadInvoices
   * 내부 표준 orderId + tracking을 쿠팡의 orderSheetInvoiceApplyDtos로 번역
   */
  private async executeDispatchShip(command: {
    type: 'dispatch.ship';
    orderId: string;
    items?: Array<{ orderItemId: string; quantity: number }>;
    tracking: { companyCode: string; number: string };
    dispatchedAt?: string;
  }): Promise<SyncResult> {
    try {
      console.log('🚚 쿠팡 발송 처리 실행:', command);

      // 🔄 표준 orderId → 쿠팡 orderSheetInvoiceApplyDtos 번역
      const orderSheetInvoiceApplyDtos = await this.translateOrderToInvoiceDtos(
        command.orderId,
        command.tracking,
        command.items,
      );

      const response = await this.coupangOrderClient.uploadInvoices({
        vendorId: this.getCoupangVendorId(),
        orderSheetInvoiceApplyDtos,
      });

      return this.transformCoupangResponseToSyncResult(response, 'dispatch.ship');
    } catch (error) {
      console.error('❌ 쿠팡 발송 처리 실패:', error);
      return {
        success: false,
        errors: [{ message: `발송 처리 실패: ${error.message}` }],
        failedCount: 1,
      };
    }
  }

  /**
   * 표준 명령: dispatch.update_tracking → 쿠팡 API: updateInvoices
   */
  private async executeDispatchUpdateTracking(command: {
    type: 'dispatch.update_tracking';
    orderId: string;
    tracking: { companyCode: string; number: string };
  }): Promise<SyncResult> {
    try {
      console.log('📝 쿠팡 송장 업데이트 실행:', command);

      const orderSheetInvoiceApplyDtos = await this.translateOrderToUpdateInvoiceDtos(
        command.orderId,
        command.tracking,
      );

      const response = await this.coupangOrderClient.updateInvoices({
        vendorId: this.getCoupangVendorId(),
        orderSheetInvoiceApplyDtos,
      });

      return this.transformCoupangResponseToSyncResult(response, 'dispatch.update_tracking');
    } catch (error) {
      console.error('❌ 쿠팡 송장 업데이트 실패:', error);
      return {
        success: false,
        errors: [{ message: `송장 업데이트 실패: ${error.message}` }],
        failedCount: 1,
      };
    }
  }

  /**
   * 표준 명령: return.approve → 쿠팡 API: approveReturnRequest
   * 내부 표준 claimId를 쿠팡의 receiptId + cancelCount로 번역
   */
  private async executeReturnApprove(command: {
    type: 'return.approve';
    claimId: string;
    items?: Array<{ orderItemId: string; quantity: number }>;
  }): Promise<SyncResult> {
    try {
      console.log('✅ 쿠팡 반품 승인 실행:', command);

      // 🔄 표준 claimId → 쿠팡 receiptId + cancelCount 번역
      const coupangClaimInfo = await this.translateClaimIdToCoupangInfo(command.claimId);

      const response = await this.coupangReturnClient.approveReturnRequest({
        vendorId: this.getCoupangVendorId(),
        receiptId: coupangClaimInfo.receiptId,
        cancelCount: coupangClaimInfo.cancelCount,
      });

      return {
        success: response.code === '200',
        processedCount: 1,
        data: response,
      };
    } catch (error) {
      console.error('❌ 쿠팡 반품 승인 실패:', error);
      return {
        success: false,
        errors: [{ message: `반품 승인 실패: ${error.message}` }],
        failedCount: 1,
      };
    }
  }

  /**
   * 표준 명령: return.confirm_receipt → 쿠팡 API: confirmReturnReceipt
   */
  private async executeReturnConfirmReceipt(command: {
    type: 'return.confirm_receipt';
    claimId: string;
  }): Promise<SyncResult> {
    try {
      console.log('📦 쿠팡 반품상품 입고확인 실행:', command);

      const coupangClaimInfo = await this.translateClaimIdToCoupangInfo(command.claimId);

      const response = await this.coupangReturnClient.confirmReturnReceipt({
        vendorId: this.getCoupangVendorId(),
        receiptId: coupangClaimInfo.receiptId,
      });

      return this.transformCoupangResponseToSyncResult(response, 'return.confirm_receipt');
    } catch (error) {
      console.error('❌ 쿠팡 반품상품 입고확인 실패:', error);
      return {
        success: false,
        errors: [{ message: `반품상품 입고확인 실패: ${error.message}` }],
        failedCount: 1,
      };
    }
  }

  /**
   * 표준 명령: return.process_shipment_stop → 쿠팡 API: stoppedShipment
   */
  private async executeReturnProcessShipmentStop(command: {
    type: 'return.process_shipment_stop';
    claimId: string;
    reason?: string;
  }): Promise<SyncResult> {
    try {
      console.log('⏹️ 쿠팡 출고중지 처리 실행:', command);

      const coupangClaimInfo = await this.translateClaimIdToCoupangInfo(command.claimId);

      const response = await this.coupangReturnClient.stoppedShipment({
        vendorId: this.getCoupangVendorId(),
        receiptId: coupangClaimInfo.receiptId,
        cancelCount: coupangClaimInfo.cancelCount,
      });

      return this.transformCoupangResponseToSyncResult(response, 'return.process_shipment_stop');
    } catch (error) {
      console.error('❌ 쿠팡 출고중지 처리 실패:', error);
      return {
        success: false,
        errors: [{ message: `출고중지 처리 실패: ${error.message}` }],
        failedCount: 1,
      };
    }
  }

  /**
   * 쿠팡 이미출고처리
   */
  private async executeReturnCompletedShipment(command: any): Promise<SyncResult> {
    try {
      console.log('🚛 쿠팡 이미출고처리 실행:', command);

      const response = await this.coupangReturnClient.completedShipment({
        vendorId: command.vendorId,
        receiptId: command.receiptId,
        deliveryCompanyCode: command.deliveryCompanyCode,
        invoiceNumber: command.invoiceNumber,
      });

      return this.transformCoupangResponseToSyncResult(response, 'return.completed_shipment');
    } catch (error) {
      console.error('❌ 쿠팡 이미출고처리 실패:', error);
      return {
        success: false,
        errors: [{ message: `이미출고처리 실패: ${error.message}` }],
        failedCount: 1,
      };
    }
  }

  /**
   * 쿠팡 회수송장 등록
   */
  private async executeReturnRegisterInvoice(command: any): Promise<SyncResult> {
    try {
      console.log('📋 쿠팡 회수송장 등록 실행:', command);

      const response = await this.coupangReturnClient.registerReturnInvoice({
        returnExchangeDeliveryType: command.returnExchangeDeliveryType,
        receiptId: command.receiptId,
        deliveryCompanyCode: command.deliveryCompanyCode,
        invoiceNumber: command.invoiceNumber,
        regNumber: command.regNumber,
      });

      return this.transformCoupangResponseToSyncResult(response, 'return.register_invoice');
    } catch (error) {
      console.error('❌ 쿠팡 회수송장 등록 실패:', error);
      return {
        success: false,
        errors: [{ message: `회수송장 등록 실패: ${error.message}` }],
        failedCount: 1,
      };
    }
  }

  /**
   * 쿠팡 반품 철회 이력 기간별 조회
   */
  private async executeReturnWithdrawalHistory(command: any): Promise<SyncResult> {
    try {
      console.log('📊 쿠팡 반품 철회 이력 조회 실행:', command);

      const response = await this.coupangReturnClient.getReturnWithdrawalHistory({
        dateFrom: command.dateFrom,
        dateTo: command.dateTo,
        pageIndex: command.pageIndex || 1,
        sizePerPage: command.sizePerPage || 10,
      });

      return {
        success: true,
        processedCount: response.data.length,
        data: response,
      };
    } catch (error) {
      console.error('❌ 쿠팡 반품 철회 이력 조회 실패:', error);
      return {
        success: false,
        errors: [{ message: `반품 철회 이력 조회 실패: ${error.message}` }],
        failedCount: 1,
      };
    }
  }

  /**
   * 쿠팡 반품 철회 이력 접수번호로 조회
   */
  private async executeReturnWithdrawalHistoryByIds(command: any): Promise<SyncResult> {
    try {
      console.log('🔍 쿠팡 반품 철회 이력(ID) 조회 실행:', command);

      const response = await this.coupangReturnClient.getReturnWithdrawalHistoryByIds({
        cancelIds: command.cancelIds,
      });

      return {
        success: true,
        processedCount: response.data.length,
        data: response,
      };
    } catch (error) {
      console.error('❌ 쿠팡 반품 철회 이력(ID) 조회 실패:', error);
      return {
        success: false,
        errors: [{ message: `반품 철회 이력(ID) 조회 실패: ${error.message}` }],
        failedCount: 1,
      };
    }
  }

  /**
   * 쿠팡 배송상태 변경 히스토리 조회
   */
  private async executeDeliveryHistory(command: any): Promise<SyncResult> {
    try {
      console.log('📋 쿠팡 배송상태 히스토리 조회 실행:', command);

      const response = await this.coupangOrderClient.getDeliveryHistory(command.shipmentBoxId);

      return {
        success: true,
        processedCount: response.data?.histories?.length || 0,
        data: response,
      };
    } catch (error) {
      console.error('❌ 쿠팡 배송상태 히스토리 조회 실패:', error);
      return {
        success: false,
        errors: [{ message: `배송상태 히스토리 조회 실패: ${error.message}` }],
        failedCount: 1,
      };
    }
  }

  /**
   * 🔄 이미출고처리 명령 실행
   *
   * 출고중지요청/반품접수미확인 상태에서 이미 발송한 경우 상태를 변경합니다.
   *
   * @param command 표준 명령 객체
   * @returns 처리 결과
   *
   * @example
   * ```typescript
   * const result = await adapter.executeCommand({
   *   type: 'return.process_already_shipped',
   *   claimId: '12345678',
   *   tracking: {
   *     companyCode: 'CJ',
   *     number: '123456789012'
   *   }
   * });
   * ```
   */
  private async executeReturnProcessAlreadyShipped(command: any): Promise<SyncResult> {
    this.logger.log(`🔄 [쿠팡] 이미출고처리 실행: claimId=${command.claimId}`);

    try {
      // 1. 택배사 코드 변환 (표준 → 쿠팡)
      const coupangCompanyCode = this.mapDeliveryCompanyCode(command.tracking.companyCode);

      // 2. API 호출
      const response = await this.coupangReturnClient.completedShipment({
        vendorId: process.env.COUPANG_VENDOR_ID!,
        receiptId: Number(command.claimId),
        deliveryCompanyCode: coupangCompanyCode,
        invoiceNumber: command.tracking.number,
      });

      // 3. 결과 확인
      if (response.data.resultCode === 'SUCCESS') {
        this.logger.log(`✅ [쿠팡] 이미출고처리 성공: ${command.claimId} - ${response.data.resultMessage}`);
        return {
          success: true,
          processedCount: 1,
        };
      } else {
        throw new Error(response.data.resultMessage);
      }
    } catch (error) {
      this.logger.error(`❌ [쿠팡] 이미출고처리 실패: ${command.claimId}`, error.message);
      return {
        success: false,
        processedCount: 0,
        failedCount: 1,
        errors: [
          {
            id: command.claimId,
            message: error.message,
          },
        ],
      };
    }
  }

  /**
   * 🚚 회수송장 등록 명령 실행
   *
   * 반품/교환에 대한 회수송장을 직접 등록합니다.
   *
   * @param command 표준 명령 객체
   * @returns 처리 결과
   *
   * @example
   * ```typescript
   * // 반품 회수송장 등록
   * const result = await adapter.executeCommand({
   *   type: 'return.register_collection_invoice',
   *   claimId: '12345678',
   *   collectionType: 'RETURN',
   *   tracking: {
   *     companyCode: 'HANJIN',
   *     number: '987654321098'
   *   }
   * });
   *
   * // 교환 회수송장 등록
   * const result = await adapter.executeCommand({
   *   type: 'return.register_collection_invoice',
   *   claimId: '87654321',
   *   collectionType: 'EXCHANGE',
   *   tracking: {
   *     companyCode: 'LOTTE',
   *     number: '555666777888'
   *   }
   * });
   * ```
   */
  private async executeReturnRegisterCollectionInvoice(command: any): Promise<SyncResult> {
    this.logger.log(`🚚 [쿠팡] 회수송장 등록 실행: claimId=${command.claimId}, type=${command.collectionType}`);

    try {
      // 1. 택배사 코드 변환 (표준 → 쿠팡)
      const coupangCompanyCode = this.mapDeliveryCompanyCode(command.tracking.companyCode);

      // 2. API 호출
      const response = await this.coupangReturnClient.registerReturnInvoice({
        returnExchangeDeliveryType: command.collectionType,
        receiptId: Number(command.claimId),
        deliveryCompanyCode: coupangCompanyCode,
        invoiceNumber: command.tracking.number,
      });

      // 3. 결과 확인 (API 응답이 성공하면 code=200)
      if (response.code === 200) {
        this.logger.log(`✅ [쿠팡] 회수송장 등록 성공: ${command.claimId} - receiptId=${response.data.receiptId}`);
        return {
          success: true,
          processedCount: 1,
        };
      } else {
        throw new Error(response.message || '회수송장 등록 실패');
      }
    } catch (error) {
      this.logger.error(`❌ [쿠팡] 회수송장 등록 실패: ${command.claimId}`, error.message);
      return {
        success: false,
        processedCount: 0,
        failedCount: 1,
        errors: [
          {
            id: command.claimId,
            message: error.message,
          },
        ],
      };
    }
  }

  // =================================================================
  // == 교환 관련 명령 실행 메서드들 (Exchange Command Methods)
  // =================================================================

  /**
   * 표준 명령: exchange.confirm_receipt → 쿠팡 API: confirmExchangeReceipt
   * 교환 상품 입고 확인 처리
   */
  private async executeExchangeConfirmReceipt(command: {
    type: 'exchange.confirm_receipt';
    claimId: string;
  }): Promise<SyncResult> {
    try {
      console.log('📦 쿠팡 교환 상품 입고확인 실행:', command);

      // 🔄 표준 claimId → 쿠팡 exchangeId 번역
      const exchangeId = await this.translateClaimIdToExchangeId(command.claimId);

      const response = await this.coupangExchangeClient.confirmExchangeReceipt({
        vendorId: this.getCoupangVendorId(),
        exchangeId,
      });

      return {
        success: response.code === '200',
        processedCount: 1,
        data: response,
      };
    } catch (error) {
      console.error('❌ 쿠팡 교환 상품 입고확인 실패:', error);
      return {
        success: false,
        errors: [{ message: `교환 상품 입고확인 실패: ${error.message}` }],
        failedCount: 1,
      };
    }
  }

  /**
   * 표준 명령: exchange.reject → 쿠팡 API: rejectExchangeRequest
   * 교환 요청 거부 처리
   */
  private async executeExchangeReject(command: {
    type: 'exchange.reject';
    claimId: string;
    reason: string;
  }): Promise<SyncResult> {
    try {
      console.log('🚫 쿠팡 교환 요청 거부 실행:', command);

      // 🔄 표준 claimId → 쿠팡 exchangeId 번역
      const exchangeId = await this.translateClaimIdToExchangeId(command.claimId);

      // 🔄 표준 reason → 쿠팡 exchangeRejectCode 번역
      const exchangeRejectCode = this.translateReasonToRejectCode(command.reason);

      const response = await this.coupangExchangeClient.rejectExchangeRequest({
        vendorId: this.getCoupangVendorId(),
        exchangeId,
        exchangeRejectCode,
      });

      return {
        success: response.data.resultCode === 'SUCCESS',
        processedCount: 1,
        data: response,
      };
    } catch (error) {
      console.error('❌ 쿠팡 교환 요청 거부 실패:', error);
      return {
        success: false,
        errors: [{ message: `교환 요청 거부 실패: ${error.message}` }],
        failedCount: 1,
      };
    }
  }

  /**
   * 표준 명령: exchange.upload_invoice → 쿠팡 API: uploadExchangeInvoice
   * 교환 재발송 송장 업로드
   */
  private async executeExchangeUploadInvoice(command: {
    type: 'exchange.upload_invoice';
    claimId: string;
    tracking: { companyCode: string; number: string };
    items?: Array<{ itemId: string; shipmentBoxId: string }>;
  }): Promise<SyncResult> {
    try {
      console.log('🚀 쿠팡 교환 송장 업로드 실행:', command);

      // 🔄 표준 claimId → 쿠팡 exchangeId 번역
      const exchangeId = await this.translateClaimIdToExchangeId(command.claimId);

      // 🔄 표준 송장 정보 → 쿠팡 업로드 형식으로 번역
      const invoiceItems = await this.translateExchangeInvoiceItems(command.claimId, command.tracking, command.items);

      const response = await this.coupangExchangeClient.uploadExchangeInvoice(exchangeId, invoiceItems);

      return {
        success: response.data.resultCode === 'SUCCESS',
        processedCount: 1,
        data: response,
      };
    } catch (error) {
      console.error('❌ 쿠팡 교환 송장 업로드 실패:', error);
      return {
        success: false,
        errors: [{ message: `교환 송장 업로드 실패: ${error.message}` }],
        failedCount: 1,
      };
    }
  }

  // =================================================================
  // == 조회 메서드들 (Query Methods)
  // =================================================================

  private async queryDeliveryHistory(query: { type: 'delivery.history'; orderId: string }): Promise<any> {
    const shipmentBoxId = await this.translateOrderIdToShipmentBoxId(query.orderId);
    return await this.coupangOrderClient.getDeliveryHistory(shipmentBoxId);
  }

  private async queryReturnWithdrawalHistory(query: {
    type: 'return.withdrawal_history';
    dateFrom: string;
    dateTo: string;
    pageIndex?: number;
    sizePerPage?: number;
  }): Promise<any> {
    return await this.coupangReturnClient.getReturnWithdrawalHistory({
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      pageIndex: query.pageIndex || 1,
      sizePerPage: query.sizePerPage || 10,
    });
  }

  private async queryReturnWithdrawalHistoryByClaims(query: {
    type: 'return.withdrawal_history_by_claims';
    claimIds: string[];
  }): Promise<any> {
    const cancelIds = await this.translateClaimIdsToCancelIds(query.claimIds);
    return await this.coupangReturnClient.getReturnWithdrawalHistoryByIds({
      cancelIds,
    });
  }

  private async queryExchangeRequests(query: {
    type: 'exchange.requests';
    dateFrom: string;
    dateTo: string;
    status?: 'RECEIPT' | 'PROGRESS' | 'SUCCESS' | 'REJECT' | 'CANCEL';
    orderId?: number;
    pageIndex?: number;
    sizePerPage?: number;
  }): Promise<InternalExchangeEvent[]> {
    // 🔄 쿠팡 API 호출
    const coupangResponse = await this.coupangExchangeClient.getExchangeRequests({
      createdAtFrom: query.dateFrom,
      createdAtTo: query.dateTo,
      status: query.status,
      orderId: query.orderId,
      maxPerPage: query.sizePerPage || 10,
    });

    // 🎯 SSOT 원칙: 쿠팡 응답을 표준 내부 모델로 번역
    return coupangResponse.data.map((coupangExchange) => this.mapCoupangExchangeToInternal(coupangExchange));
  }

  // =================================================================
  // == 🔄 쿠팡 → 표준 내부 모델 번역 메서드들 (SSOT Translation)
  // =================================================================

  /**
   * 🎯 핵심 번역 메서드: 쿠팡 교환 응답 → 표준 내부 교환 이벤트
   * SSOT 원칙에 따라 외부의 복잡한 구조를 내부의 단순하고 명확한 모델로 변환
   */
  private mapCoupangExchangeToInternal(coupangExchange: CoupangExchangeRequest): InternalExchangeEvent {
    return {
      eventId: `exchange_${coupangExchange.exchangeId}_${Date.now()}`,
      eventType: this.mapExchangeEventType(coupangExchange.exchangeStatus),

      // 🔑 핵심 식별자 번역
      claimId: `EXCHANGE_${coupangExchange.exchangeId}`, // 내부 표준 클레임 ID
      orderId: `ORDER_${coupangExchange.orderId}`, // 내부 표준 주문 ID

      // 📍 채널 정보
      channel: 'coupang',
      externalClaimId: String(coupangExchange.exchangeId),
      externalOrderId: String(coupangExchange.orderId),

      // 📊 상태 번역 (쿠팡 → 표준)
      status: this.mapCoupangExchangeStatusToInternal(coupangExchange.exchangeStatus),

      // 🎯 귀책사유 번역
      faultType: this.mapCoupangFaultTypeToInternal(coupangExchange.faultType),

      // 📝 요청 정보
      reason: coupangExchange.reason || coupangExchange.reasonCodeText,
      reasonCode: coupangExchange.reasonCode,

      // 📦 교환 상품 정보 (핵심 필드만 추출)
      exchangeItems: coupangExchange.exchangeItemDtoV1s.map((item) => ({
        originalItemId: String(item.orderItemId),
        originalItemName: item.orderItemName,
        targetItemId: String(item.targetItemId),
        targetItemName: item.targetItemName,
        quantity: item.quantity,
        unitPrice: item.orderItemUnitPrice,
      })),

      // 🚚 배송 정보 번역
      deliveryInfo: {
        returnAddress: {
          customerName: coupangExchange.exchangeAddressDtoV1.returnCustomerName,
          address: `${coupangExchange.exchangeAddressDtoV1.returnAddress} ${coupangExchange.exchangeAddressDtoV1.returnAddressDetail}`,
          phone: coupangExchange.exchangeAddressDtoV1.returnPhone || coupangExchange.exchangeAddressDtoV1.returnMobile,
        },
        deliveryAddress: {
          customerName: coupangExchange.exchangeAddressDtoV1.deliveryCustomerName,
          address: `${coupangExchange.exchangeAddressDtoV1.deliveryAddress} ${coupangExchange.exchangeAddressDtoV1.deliveryAddressDetail}`,
          phone:
            coupangExchange.exchangeAddressDtoV1.deliveryPhone || coupangExchange.exchangeAddressDtoV1.deliveryMobile,
        },
        collectStatus: this.mapCoupangCollectStatusToInternal(coupangExchange.collectStatus),
        deliveryStatus: this.mapCoupangDeliveryStatusToInternal(coupangExchange.deliveryStatus),
      },

      // ⏰ 타임스탬프
      createdAt: coupangExchange.createdAt,
      updatedAt: coupangExchange.modifiedAt,

      // 🗃️ 메타데이터 (원본 보존 + 디버깅용)
      metadata: {
        originalPayload: coupangExchange, // 전체 쿠팡 응답 보존
        processingNotes: [
          `쿠팡 교환 ID ${coupangExchange.exchangeId}에서 변환됨`,
          `교환 상태: ${coupangExchange.exchangeStatus} → ${this.mapCoupangExchangeStatusToInternal(coupangExchange.exchangeStatus)}`,
        ],
        channelSpecificData: {
          coupangExchangeId: coupangExchange.exchangeId,
          coupangVendorId: coupangExchange.vendorId,
          successable: coupangExchange.successable,
          rejectable: coupangExchange.rejectable,
          deliveryInvoiceModifiable: coupangExchange.deliveryInvoiceModifiable,
        },
      },
    };
  }

  /**
   * 쿠팡 교환 상태를 내부 표준 상태로 번역
   */
  private mapCoupangExchangeStatusToInternal(coupangStatus: string): InternalExchangeEvent['status'] {
    const statusMapping: Record<string, InternalExchangeEvent['status']> = {
      RECEIPT: 'PENDING',
      PROGRESS: 'IN_PROGRESS',
      SUCCESS: 'COMPLETED',
      REJECT: 'REJECTED',
      CANCEL: 'CANCELLED',
    };
    return statusMapping[coupangStatus] || 'PENDING';
  }

  /**
   * 쿠팡 귀책사유를 내부 표준으로 번역
   */
  private mapCoupangFaultTypeToInternal(coupangFaultType: string): InternalExchangeEvent['faultType'] {
    const faultMapping: Record<string, InternalExchangeEvent['faultType']> = {
      SELLER: 'SELLER',
      CUSTOMER: 'CUSTOMER',
      DELIVERY: 'DELIVERY',
      PRODUCT: 'PRODUCT_DEFECT',
    };
    return faultMapping[coupangFaultType] || 'OTHER';
  }

  /**
   * 쿠팡 회수 상태를 내부 표준으로 번역
   */
  private mapCoupangCollectStatusToInternal(collectStatus: string): 'PENDING' | 'COLLECTED' | 'COMPLETED' {
    const statusMapping: Record<string, 'PENDING' | 'COLLECTED' | 'COMPLETED'> = {
      PENDING: 'PENDING',
      COLLECTED: 'COLLECTED',
      COMPLETED: 'COMPLETED',
    };
    return statusMapping[collectStatus] || 'PENDING';
  }

  /**
   * 쿠팡 배송 상태를 내부 표준으로 번역
   */
  private mapCoupangDeliveryStatusToInternal(deliveryStatus: string): 'PENDING' | 'SHIPPED' | 'DELIVERED' {
    const statusMapping: Record<string, 'PENDING' | 'SHIPPED' | 'DELIVERED'> = {
      PENDING: 'PENDING',
      SHIPPED: 'SHIPPED',
      DELIVERED: 'DELIVERED',
    };
    return statusMapping[deliveryStatus] || 'PENDING';
  }

  /**
   * 쿠팡 교환 상태를 이벤트 타입으로 번역
   */
  private mapExchangeEventType(exchangeStatus: string): InternalExchangeEvent['eventType'] {
    const eventMapping: Record<string, InternalExchangeEvent['eventType']> = {
      RECEIPT: 'exchange_created',
      PROGRESS: 'exchange_updated',
      SUCCESS: 'exchange_completed',
      REJECT: 'exchange_rejected',
      CANCEL: 'exchange_rejected',
    };
    return eventMapping[exchangeStatus] || 'exchange_updated';
  }

  // =================================================================
  // == 🔍 표준 명령 검증 메서드들 (Command Validation)
  // =================================================================

  /**
   * 표준 명령의 유효성을 검증 (네이버 패턴과 동일한 구조)
   */
  private validateStandardCommand(command: ChannelCommand): {
    success: boolean;
    errors: Array<{ message: string }>;
  } {
    try {
      // 기본 필수 필드 검증
      if (!command.type) {
        return {
          success: false,
          errors: [{ message: '명령 타입이 필요합니다' }],
        };
      }

      // 명령별 상세 검증
      switch (command.type) {
        case 'order.prepare':
          if (!command.orderIds || command.orderIds.length === 0) {
            return {
              success: false,
              errors: [{ message: 'orderIds가 필요합니다' }],
            };
          }
          break;

        case 'dispatch.ship':
          if (!command.orderId) {
            return {
              success: false,
              errors: [{ message: 'orderId가 필요합니다' }],
            };
          }
          if (!command.tracking?.companyCode || !command.tracking?.number) {
            return {
              success: false,
              errors: [{ message: '배송업체 코드와 송장번호가 필요합니다' }],
            };
          }
          break;

        case 'return.approve':
          if (!command.claimId) {
            return {
              success: false,
              errors: [{ message: 'claimId가 필요합니다' }],
            };
          }
          break;

        // ... 기타 명령들 검증
      }

      return { success: true, errors: [] };
    } catch (error) {
      return {
        success: false,
        errors: [
          {
            message: `명령 검증 중 오류: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }

  // =================================================================
  // == 🔄 번역 헬퍼 메서드들 (Translation Helpers) - 어댑터의 핵심!
  // =================================================================

  /**
   * 🔄 내부 표준 orderIds → 쿠팡 shipmentBoxIds 번역
   * 실제 구현에서는 DB 조회나 매핑 테이블을 사용
   */
  private async translateOrderIdsToShipmentBoxIds(orderIds: string[]): Promise<string[]> {
    // TODO: 실제 구현 - DB에서 내부 orderId → 쿠팡 shipmentBoxId 매핑 조회
    console.log('🔄 번역 중: orderIds → shipmentBoxIds', orderIds);

    // 임시 구현 (실제로는 DB 조회)
    return orderIds.map((orderId) => `SHIPMENT_${orderId}`);
  }

  /**
   * 🔄 내부 표준 orderId → 쿠팡 shipmentBoxId 번역 (단건)
   */
  private async translateOrderIdToShipmentBoxId(orderId: string): Promise<string> {
    const [shipmentBoxId] = await this.translateOrderIdsToShipmentBoxIds([orderId]);
    return shipmentBoxId;
  }

  /**
   * 🔄 내부 표준 claimId → 쿠팡 receiptId + cancelCount 번역
   * 실제 구현에서는 클레임 관리 시스템과 연동
   */
  private async translateClaimIdToCoupangInfo(claimId: string): Promise<{
    receiptId: number;
    cancelCount: number;
  }> {
    // 🔍 입력 검증
    if (!claimId || typeof claimId !== 'string') {
      throw new Error('유효하지 않은 claimId입니다');
    }

    try {
      // TODO: 실제 구현 - 클레임 관리 시스템에서 조회
      console.log('🔄 번역 중: claimId → 쿠팡 클레임 정보', claimId);

      // 임시 구현 (실제로는 클레임 DB 조회)
      const receiptId = parseInt(claimId.replace('CLAIM_', ''), 10);

      // 🔍 번역 결과 검증
      if (!receiptId || receiptId <= 0) {
        throw new Error(`클레임 ID를 쿠팡 receiptId로 번역할 수 없습니다: ${claimId}`);
      }

      return {
        receiptId,
        cancelCount: 1,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`클레임 정보 번역 실패: ${message}`);
    }
  }

  /**
   * 🔄 내부 표준 claimIds → 쿠팡 cancelIds 번역
   */
  private async translateClaimIdsToCancelIds(claimIds: string[]): Promise<number[]> {
    // TODO: 실제 구현 - 클레임 관리 시스템에서 매핑 조회
    console.log('🔄 번역 중: claimIds → cancelIds', claimIds);

    // 임시 구현
    return claimIds.map((claimId) => parseInt(claimId.replace('CLAIM_', ''), 10) || 123456789);
  }

  /**
   * 🔄 내부 표준 orderId + tracking → 쿠팡 orderSheetInvoiceApplyDtos 번역
   */
  private async translateOrderToInvoiceDtos(
    orderId: string,
    tracking: { companyCode: string; number: string },
    items?: Array<{ orderItemId: string; quantity: number }>,
  ): Promise<any[]> {
    // TODO: 실제 구현 - 주문 관리 시스템에서 쿠팡 발주서 정보 조회
    console.log('🔄 번역 중: 표준 주문 → 쿠팡 송장 DTO', {
      orderId,
      tracking,
      items,
    });

    // 임시 구현 (실제로는 주문 DB에서 shipmentBoxId, vendorItemId 등 조회)
    return [
      {
        shipmentBoxId: parseInt(orderId.replace('ORDER_', ''), 10) || 12345,
        orderId: parseInt(orderId.replace('ORDER_', ''), 10) || 67890,
        vendorItemId: 11111,
        deliveryCompanyCode: this.mapDeliveryCompanyCode(tracking.companyCode),
        invoiceNumber: tracking.number,
        splitShipping: false,
        preSplitShipped: false,
      },
    ];
  }

  /**
   * 🔄 송장 업데이트용 DTO 번역
   */
  private async translateOrderToUpdateInvoiceDtos(
    orderId: string,
    tracking: { companyCode: string; number: string },
  ): Promise<any[]> {
    // 기본 송장 DTO와 유사하지만 업데이트용 필드 구조
    return await this.translateOrderToInvoiceDtos(orderId, tracking);
  }

  /**
   * 🔄 배송업체 코드 매핑 (내부 표준 → 쿠팡 표준)
   */
  private mapDeliveryCompanyCode(
    internalCode: string,
  ):
    | 'CJGLS'
    | 'LOTTE'
    | 'HANJIN'
    | 'LOGEN'
    | 'EPOST'
    | 'KGB'
    | 'HYUNDAI'
    | 'DHL'
    | 'FEDEX'
    | 'UPS'
    | 'EMS'
    | 'KDEXP'
    | 'GOODTOLUCK'
    | 'DAELIM'
    | 'DONGGANG'
    | 'CHUNIL'
    | 'HONAM'
    | 'DAESIN'
    | 'ILYANG'
    | 'PANTOS'
    | 'FRESH'
    | 'CVSNET'
    | 'OTHER' {
    const mapping: Record<
      string,
      | 'CJGLS'
      | 'LOTTE'
      | 'HANJIN'
      | 'LOGEN'
      | 'EPOST'
      | 'KGB'
      | 'HYUNDAI'
      | 'DHL'
      | 'FEDEX'
      | 'UPS'
      | 'EMS'
      | 'KDEXP'
      | 'GOODTOLUCK'
      | 'DAELIM'
      | 'DONGGANG'
      | 'CHUNIL'
      | 'HONAM'
      | 'DAESIN'
      | 'ILYANG'
      | 'PANTOS'
      | 'FRESH'
      | 'CVSNET'
      | 'OTHER'
    > = {
      CJ: 'CJGLS',
      LOTTE: 'LOTTE',
      HANJIN: 'HANJIN',
      LOGEN: 'LOGEN',
      EPOST: 'EPOST',
      KGB: 'KGB',
      HYUNDAI: 'HYUNDAI',
      DHL: 'DHL',
      FEDEX: 'FEDEX',
      UPS: 'UPS',
      EMS: 'EMS',
      KDEXP: 'KDEXP',
      // ... 기타 매핑
    };
    return mapping[internalCode] || 'OTHER';
  }

  /**
   * 🔄 내부 표준 claimId → 쿠팡 exchangeId 번역
   * 실제 구현에서는 교환 관리 시스템과 연동
   */
  private async translateClaimIdToExchangeId(claimId: string): Promise<number> {
    // 🔍 입력 검증
    if (!claimId || typeof claimId !== 'string') {
      throw new Error('유효하지 않은 claimId입니다');
    }

    try {
      // TODO: 실제 구현 - 교환 관리 시스템에서 조회
      console.log('🔄 번역 중: claimId → 쿠팡 exchangeId', claimId);

      // 임시 구현 (실제로는 교환 DB 조회)
      const exchangeId = parseInt(claimId.replace('EXCHANGE_', ''), 10);

      // 🔍 번역 결과 검증
      if (!exchangeId || exchangeId <= 0) {
        throw new Error(`클레임 ID를 쿠팡 exchangeId로 번역할 수 없습니다: ${claimId}`);
      }

      return exchangeId;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`교환 ID 번역 실패: ${message}`);
    }
  }

  /**
   * 🔄 표준 reason → 쿠팡 exchangeRejectCode 번역
   */
  private translateReasonToRejectCode(reason: string): 'SOLDOUT' | 'WITHDRAW' {
    // 표준 거부 사유를 쿠팡 거부 코드로 매핑
    const mapping: Record<string, 'SOLDOUT' | 'WITHDRAW'> = {
      품절: 'SOLDOUT',
      soldout: 'SOLDOUT',
      판매중단: 'WITHDRAW',
      withdraw: 'WITHDRAW',
    };

    return mapping[reason.toLowerCase()] || 'WITHDRAW'; // 기본값: WITHDRAW
  }

  /**
   * 🔄 교환 송장 정보를 쿠팡 업로드 형식으로 번역
   */
  private async translateExchangeInvoiceItems(
    claimId: string,
    tracking: { companyCode: string; number: string },
    items?: Array<{ itemId: string; shipmentBoxId: string }>,
  ): Promise<any[]> {
    try {
      // TODO: 실제 구현 - 교환 관리 시스템에서 필요한 정보 조회
      console.log('🔄 번역 중: 표준 교환 송장 → 쿠팡 업로드 형식', {
        claimId,
        tracking,
        items,
      });

      const exchangeId = await this.translateClaimIdToExchangeId(claimId);

      // 임시 구현 (실제로는 교환 DB에서 shipmentBoxId 등 조회)
      return [
        {
          exchangeId,
          vendorId: this.getCoupangVendorId(),
          shipmentBoxId: items?.[0]?.shipmentBoxId || 12345,
          goodsDeliveryCode: this.mapDeliveryCompanyCode(tracking.companyCode),
          invoiceNumber: tracking.number,
        },
      ];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`교환 송장 정보 번역 실패: ${message}`);
    }
  }

  /**
   * 🔧 쿠팡 vendorId 조회
   */
  private getCoupangVendorId(): string {
    return process.env.COUPANG_VENDOR_ID || '';
  }

  /**
   * 쿠팡 API 응답을 SyncResult로 변환하는 헬퍼 메서드
   */
  private transformCoupangResponseToSyncResult(coupangResponse: any, commandType: string): SyncResult {
    const responseList = coupangResponse.data?.responseList || [];
    const successCount = responseList.filter((item: any) => item.succeed === true).length;
    const failedItems = responseList.filter((item: any) => item.succeed === false);

    return {
      success: failedItems.length === 0,
      processedCount: successCount,
      failedCount: failedItems.length,
      errors: failedItems.map((item: any) => ({
        id: item.shipmentBoxId?.toString() || 'unknown',
        message: item.resultMessage || '알 수 없는 오류',
      })),
      data: {
        commandType,
        timestamp: new Date().toISOString(),
        coupangResponse,
      },
    };
  }

  /**
   * 주문 이벤트 발행
   *
   * 동기화된 주문들에 대해 상태에 따라 적절한 이벤트를 발행합니다.
   * - ACCEPT 상태: OrderCreated 이벤트 발행 (매핑 자동 조회, 미매핑 시 계류)
   * - CANCELLED 상태: OrderCancelled 이벤트 발행
   */
  private async publishOrderEvents(events: InternalOrderEvent[]): Promise<void> {
    let publishedCount = 0;
    let pendingCount = 0;

    for (const event of events) {
      try {
        switch (event.status) {
          case 'PENDING':
          case 'PAID':
          case 'PROCESSING':
            // 새로운 주문 - 매핑 조회 후 OrderCreated 발행 또는 계류
            const result = await this.orderEventPublisher.publishOrderConfirmed('coupang', event);

            if (result.published) {
              publishedCount++;
            } else if (result.unmappedItems && result.unmappedItems.length > 0) {
              // 미매핑 항목 → 계류 처리
              await this.pendingOrderService.savePendingOrder('coupang', event, result.unmappedItems);
              pendingCount++;
            }
            break;

          case 'CANCELLED':
            // 취소된 주문 - OrderCancelled 발행
            await this.orderEventPublisher.publishOrderCancelled('coupang', event, event.reason ?? 'CUSTOMER_REQUEST');
            publishedCount++;
            break;

          default:
            this.logger.debug(`📋 [쿠팡] 이벤트 발행 스킵 (status=${event.status}): ${event.externalOrderId}`);
        }
      } catch (error) {
        this.logger.error(
          `❌ [쿠팡] 주문 이벤트 발행 실패: ${event.externalOrderId}`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    if (publishedCount > 0 || pendingCount > 0) {
      this.logger.log(`📤 [쿠팡] 주문 이벤트 처리 완료: ${publishedCount}건 발행, ${pendingCount}건 계류`);
    }
  }
}
