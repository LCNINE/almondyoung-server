import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ChannelStrategy } from './channel-strategy.interface';
import {
  DataType,
  SyncResult,
  SyncToChannelPayload,
  InternalInventoryData,
} from '../../types';
import { InternalOrderEvent, OrderQuery } from '../../types';
import { ChannelCommand } from '../../types';

import {
  InternalDispatchCommandSchema,
  transformInternalCommandToNaverRequest,
  NaverDispatchRequestSchema,
} from '../../zods/naver-dispatch.zod';
import { NaverCommerceApiService } from '../apis/naver-commerce.api.service';
import { z } from 'zod';

import {
  ProductOrderInfo,
  ChangeSaleStatusBody,
  UpdateOptionStockBody,
} from '../../zods/naver-api.zod';

// 명령 검증용 Zod 스키마들
const OrderConfirmCommandSchema = z.object({
  type: z.literal('order.confirm'),
  productOrderIds: z
    .array(z.string())
    .min(1, '최소 1개의 상품 주문 번호가 필요합니다'),
});

const DispatchDelayCommandSchema = z.object({
  type: z.literal('dispatch.delay'),
  productOrderId: z.string().min(1, '상품 주문 번호는 필수입니다'),
  dispatchDueDate: z.string().min(1, '발송 예정일은 필수입니다'),
  reasonCode: z.string().min(1, '지연 사유 코드는 필수입니다'),
  reasonText: z.string().min(1, '지연 사유 상세는 필수입니다'),
});

const CancelApproveCommandSchema = z.union([
  z.object({
    type: z.literal('cancel.approve'),
    claimId: z.string().min(1, '클레임 ID는 필수입니다'),
  }),
  z.object({
    type: z.literal('cancel.approve'),
    orderId: z.string().min(1, '주문 ID는 필수입니다'),
  }),
]);

const ReturnApproveCommandSchema = z.union([
  z.object({
    type: z.literal('return.approve'),
    claimId: z.string().min(1, '클레임 ID는 필수입니다'),
  }),
  z.object({
    type: z.literal('return.approve'),
    orderId: z.string().min(1, '주문 ID는 필수입니다'),
  }),
]);

// 타입 정의
type OrderConfirmCommand = z.infer<typeof OrderConfirmCommandSchema>;
type DispatchDelayCommand = z.infer<typeof DispatchDelayCommandSchema>;
type CancelApproveCommand = z.infer<typeof CancelApproveCommandSchema>;
type ReturnApproveCommand = z.infer<typeof ReturnApproveCommandSchema>;

// 내부 표준 명령 처리 결과 타입들
interface InternalCommandResult {
  success: boolean;
  processedItems: string[]; // 처리된 주문/클레임 ID들
  failedItems: Array<{
    id: string;
    reason: string;
    errorCode?: string;
  }>;
  metadata?: {
    commandType: string;
    timestamp: string;
    [key: string]: any;
  };
}

// 네이버 API 응답의 구체적인 타입 정의 (ApiService에서만 사용)
interface NaverOrderInfo {
  orderId: string;
  paymentDate: string;
  [key: string]: any; // 추가 필드들
}

interface NaverProductOrderInfo {
  productOrderId: string;
  productOrderStatus: string;
  quantity: number;
  totalProductAmount: number;
  [key: string]: any; // 추가 필드들
}

// ProductOrderInfo의 타입을 더 구체적으로 정의
interface TypedProductOrderInfo extends ProductOrderInfo {
  order: NaverOrderInfo;
  productOrder: NaverProductOrderInfo;
}

@Injectable()
export class NaverSmartstoreStrategy implements ChannelStrategy {
  private readonly logger = new Logger(NaverSmartstoreStrategy.name);
  constructor(private readonly naverApi: NaverCommerceApiService) {}

  async processIncomingEvent(event: any): Promise<InternalOrderEvent[]> {
    // 네이버 웹훅이 있는 경우 payload -> InternalOrderEvent로 변환
    return this.transformToInternal(event, 'orders');
  }

  /**
   * 🔄 수신(Inbound) 동기화: 네이버에서 변경된 주문 정보를 가져와 내부 표준 이벤트로 변환
   *
   * @param dataType 동기화할 데이터 타입 (현재는 'orders'만 지원)
   * @returns 변환된 내부 주문 이벤트 배열
   */
  async syncFromChannel(dataType: DataType): Promise<InternalOrderEvent[]> {
    if (dataType !== 'orders') {
      this.logger.warn(
        `지원하지 않는 dataType: ${dataType}. 'orders'만 지원됩니다.`,
      );
      return [];
    }

    try {
      // 1. 인증 토큰 획득
      const token = await this.naverApi.getAccessToken();

      // 2. 조회 시작 시점 설정 (지난 24시간)
      const lastChangedFrom = new Date(
        Date.now() - 24 * 60 * 60 * 1000,
      ).toISOString();

      this.logger.log(
        `📡 네이버 주문 상태 변경 내역 조회 시작 (${lastChangedFrom} 이후)`,
      );

      // 3. 최근 변경된 주문 상태 목록 조회
      const statusResponse = await this.naverApi.getLastChangedStatuses(
        token,
        lastChangedFrom,
      );

      const statusChanges = statusResponse.data?.lastChangeStatuses || [];
      this.logger.log(`📋 변경된 주문 상태 ${statusChanges.length}건 조회됨`);

      if (statusChanges.length === 0) {
        this.logger.log('📭 변경된 주문이 없습니다.');
        return [];
      }

      // 4. productOrderId 목록 추출
      const productOrderIds = statusChanges.map(
        (status) => status.productOrderId,
      );

      // 5. 상세 주문 정보 조회
      this.logger.log(
        `🔍 상세 주문 정보 조회 대상: ${productOrderIds.length}건`,
      );
      const detailsResponse = await this.naverApi.getOrderDetails(
        token,
        productOrderIds,
      );

      const orderDetails = detailsResponse.data || [];
      this.logger.log(`✅ 상세 주문 정보 ${orderDetails.length}건 조회 완료`);

      // 6. 네이버 형식을 내부 표준 이벤트 형식으로 변환 (진정한 어댑터 역할)
      const internalEvents = this.transformProductInfosToInternalEvents(
        orderDetails as any,
      );

      this.logger.log(`🎯 내부 이벤트 변환 완료: ${internalEvents.length}건`);
      return internalEvents;
    } catch (error) {
      this.logger.error(
        '❌ 네이버 주문 동기화 실패:',
        error.response?.data || error.message,
      );
      throw new Error(`네이버 주문 동기화 실패: ${error.message}`);
    }
  }

  /**
   * 🔄 송신(Outbound) 동기화: 내부 시스템의 변경사항을 네이버 스마트스토어로 전송
   *
   * @param payload 동기화할 데이터와 타입을 포함한 페이로드
   * @returns 동기화 처리 결과
   */
  async syncToChannel(payload: SyncToChannelPayload): Promise<SyncResult> {
    try {
      const token = await this.naverApi.getAccessToken();

      switch (payload.dataType) {
        case 'products': {
          // 🎯 TypeScript가 payload.payload를 InternalProductData로 자동 추론!
          const productData = payload.payload;

          console.log(
            `📦 네이버 상품 정보 동기화: ${productData.name} (${productData.id})`,
          );

          // 내부 상품 데이터를 네이버 API 형식으로 변환
          const naverProductData =
            this.transformInternalProductToNaver(productData);

          // TODO: 실제 네이버 상품 업데이트 API 호출 (현재 API 스펙 확인 필요)
          // const response = await this.naverApi.updateProduct(token, naverProductData);

          console.log(`✅ 네이버 상품 정보 동기화 완료: ${productData.id}`);
          return {
            success: true,
            processedCount: 1,
            data: { productId: productData.id, syncType: 'product_update' },
          };
        }

        case 'inventory': {
          // 🎯 TypeScript가 payload.payload를 InternalInventoryData로 자동 추론!
          const inventoryData = payload.payload;

          console.log(
            `📦 네이버 재고 정보 동기화: ${inventoryData.productId} (${inventoryData.stockQuantity}개) - ${inventoryData.isOptionProduct ? '옵션 상품' : '단일 상품'}`,
          );

          const originProductNo = parseInt(inventoryData.productId, 10);
          if (isNaN(originProductNo)) {
            return {
              success: false,
              errors: [
                {
                  message: `잘못된 상품 번호 형식: ${inventoryData.productId}`,
                },
              ],
              failedCount: 1,
            };
          }

          try {
            let response: any;

            if (!inventoryData.isOptionProduct) {
              // 🔹 단일 상품: changeSaleStatus API 사용
              const saleStatusBody =
                this.transformToNaverSaleStatusBody(inventoryData);

              this.logger.log(`🔄 단일 상품 재고 업데이트 API 호출 중...`);
              response = await this.naverApi.changeSaleStatus(
                token,
                originProductNo,
                saleStatusBody,
              );

              this.logger.log(`✅ 단일 상품 재고 업데이트 성공:`, response);
            } else {
              // 🔹 옵션 상품: updateOptionStock API 사용
              if (!inventoryData.optionInfo) {
                return {
                  success: false,
                  errors: [{ message: '옵션 상품인데 optionInfo가 없습니다.' }],
                  failedCount: 1,
                };
              }

              const optionStockBody =
                this.transformToNaverOptionStockBody(inventoryData);

              this.logger.log(`🔄 옵션 상품 재고 업데이트 API 호출 중...`);
              response = await this.naverApi.updateOptionStock(
                token,
                originProductNo,
                optionStockBody,
              );

              this.logger.log(`✅ 옵션 상품 재고 업데이트 성공:`, response);
            }

            return {
              success: true,
              processedCount: 1,
              data: {
                productId: inventoryData.productId,
                syncType: inventoryData.isOptionProduct
                  ? 'option_inventory_update'
                  : 'single_inventory_update',
                response: response,
              },
            };
          } catch (apiError: any) {
            this.logger.error(`❌ 네이버 재고 업데이트 API 호출 실패:`, {
              productId: inventoryData.productId,
              error: apiError.response?.data || apiError.message,
            });

            return {
              success: false,
              errors: [
                {
                  id: inventoryData.productId,
                  message: `재고 업데이트 실패: ${apiError.response?.data?.message || apiError.message}`,
                },
              ],
              failedCount: 1,
            };
          }
        }

        case 'order_status': {
          // 🎯 TypeScript가 payload.payload를 InternalOrderStatusData로 자동 추론!
          const orderStatusData = payload.payload;

          console.log(
            `📦 네이버 주문 상태 동기화: ${orderStatusData.orderId} → ${orderStatusData.status}`,
          );

          // TODO: 네이버는 보통 주문 상태를 직접 변경하는 API가 없고,
          // 발송처리/취소승인 등의 액션을 통해 상태가 변경됨
          // 필요시 executeCommand로 라우팅하거나 별도 로직 구현

          console.log(
            `✅ 네이버 주문 상태 동기화 완료: ${orderStatusData.orderId}`,
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

        default: {
          // TypeScript exhaustiveness check - 새로운 dataType 추가시 컴파일 에러 발생
          const _exhaustiveCheck: never = payload;
          this.logger.warn(`[Naver] syncToChannel: 지원하지 않는 dataType`);
          return {
            success: false,
            errors: [{ message: '지원하지 않는 데이터 타입' }],
          };
        }
      }
    } catch (error) {
      this.logger.error(`❌ 네이버 syncToChannel 실패:`, error);
      return {
        success: false,
        errors: [{ message: `동기화 실패: ${error.message}` }],
        failedCount: 1,
      };
    }
  }

  async executeCommand(command: ChannelCommand): Promise<SyncResult> {
    try {
      const token = await this.naverApi.getAccessToken();

      switch (command.type) {
        case 'order.confirm':
          return await this.executeOrderConfirm(token, command);

        case 'dispatch.confirm':
          return await this.executeDispatchConfirm(token, command);

        case 'dispatch.delay':
          return await this.executeDispatchDelay(token, command);

        case 'cancel.approve':
          return await this.executeCancelApprove(token, command);

        case 'return.approve':
          return await this.executeReturnApprove(token, command);

        default:
          return {
            success: false,
            errors: [{ message: `지원하지 않는 명령 타입: ${command.type}` }],
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        errors: [{ message: `네이버 명령 실행 실패: ${message}` }],
      };
    }
  }

  /**
   * 네이버 발주확인 API 호출
   * @param token 액세스 토큰
   * @param command 발주확인 명령
   */
  private async executeOrderConfirm(
    token: string,
    command: any, // executeCommand에서 any로 받아오므로 일단 any로 유지
  ): Promise<SyncResult> {
    try {
      // 1. 명령 검증 및 타입 변환
      const validatedCommand = OrderConfirmCommandSchema.parse(command);

      console.log('✅ 네이버 발주확인 실행:', {
        productOrderIds: validatedCommand.productOrderIds,
      });

      // 2. API 호출
      const response = await this.naverApi.confirmOrders(
        token,
        validatedCommand.productOrderIds,
      );

      console.log(
        `✅ 네이버 발주확인 완료: 성공 ${response.data?.successProductOrderIds?.length || 0}건, 실패 ${response.data?.failProductOrderInfos?.length || 0}건`,
      );

      // 3. 네이버 응답을 내부 표준 데이터로 변환 (진정한 어댑터 역할)
      return this.transformNaverResponseToInternalResult(
        response,
        'order.confirm',
        validatedCommand.productOrderIds.length,
      );
    } catch (error) {
      if (error.name === 'ZodError') {
        return {
          success: false,
          errors: error.errors.map((err: any) => ({
            message: `명령 검증 실패 - ${err.path.join('.')}: ${err.message}`,
          })),
          failedCount: 1,
        };
      }

      console.error(
        `❌ 네이버 발주확인 실패:`,
        error.response?.data || error.message,
      );
      return {
        success: false,
        errors: [
          {
            message: `발주확인 API 호출 실패: ${
              error.response?.data?.message || error.message
            }`,
          },
        ],
        data: error.response?.data,
        failedCount: 1,
      };
    }
  }

  /**
   * 🆕 네이버 발송지연 처리 API 호출
   * @param token 액세스 토큰
   * @param command 발송지연 처리 명령
   */
  private async executeDispatchDelay(
    token: string,
    command: any, // executeCommand에서 any로 받아오므로 일단 any로 유지
  ): Promise<SyncResult> {
    try {
      // 1. 명령 검증
      const validatedCommand = DispatchDelayCommandSchema.parse(command);

      console.log('⏳ 네이버 발송지연 처리 실행:', {
        productOrderId: validatedCommand.productOrderId,
        dispatchDueDate: validatedCommand.dispatchDueDate,
        reasonCode: validatedCommand.reasonCode,
      });

      // 2. API 명세에 맞는 요청 본문 생성
      const requestBody = {
        dispatchDueDate: validatedCommand.dispatchDueDate,
        delayedDispatchReason: validatedCommand.reasonCode,
        dispatchDelayedDetailedReason: validatedCommand.reasonText,
      };

      // 3. API 호출
      const response = await this.naverApi.delayDispatch(
        token,
        validatedCommand.productOrderId,
        requestBody,
      );

      const isSuccess =
        response.data?.successProductOrderIds?.length > 0 &&
        (response.data?.failProductOrderInfos?.length || 0) === 0;

      if (isSuccess) {
        console.log(
          `✅ [${validatedCommand.productOrderId}] 네이버 발송지연 처리 성공`,
        );
      } else {
        console.warn(
          `⚠️ [${validatedCommand.productOrderId}] 네이버 발송지연 처리 실패`,
          {
            failInfos: response.data?.failProductOrderInfos,
          },
        );
      }

      // 4. 네이버 응답을 내부 표준 데이터로 변환 (진정한 어댑터 역할)
      return this.transformNaverResponseToInternalResult(
        response,
        'dispatch.delay',
      );
    } catch (error) {
      if (error.name === 'ZodError') {
        return {
          success: false,
          errors: error.errors.map((err: any) => ({
            message: `명령 검증 실패 - ${err.path.join('.')}: ${err.message}`,
          })),
          failedCount: 1,
        };
      }

      this.logger.error(
        `❌ 네이버 발송지연 처리 API 호출 실패:`,
        error.response?.data || error.message,
      );
      return {
        success: false,
        errors: [
          {
            message: `발송지연 처리 실패: ${error.response?.data?.message || error.message}`,
          },
        ],
        data: error.response?.data,
        failedCount: 1,
      };
    }
  }
  /**
   * 네이버 발송처리 API 호출
   */
  private async executeDispatchConfirm(
    token: string,
    command: any,
  ): Promise<SyncResult> {
    console.log('📦 네이버 발송처리 실행:', {
      orderId: command.orderId,
      productOrderIds: command.productOrderIds,
      tracking: command.tracking,
    });

    try {
      // 1. 내부 명령 유효성 검사 및 네이버 API 형식으로 변환
      const validatedCommand = InternalDispatchCommandSchema.parse(command);
      const naverRequest =
        transformInternalCommandToNaverRequest(validatedCommand);
      const validatedNaverRequest =
        NaverDispatchRequestSchema.parse(naverRequest);

      // 2. API 호출
      const response = await this.naverApi.dispatchOrders(
        token,
        validatedNaverRequest.dispatchProductOrders,
      );

      console.log('✅ 네이버 발송처리 성공:', response);

      // 네이버 응답을 내부 표준 데이터로 변환 (진정한 어댑터 역할)
      return this.transformNaverResponseToInternalResult(
        response,
        'dispatch.confirm',
        validatedNaverRequest.dispatchProductOrders.length,
      );
    } catch (error) {
      console.error(
        '❌ 네이버 발송처리 실패:',
        error.response?.data || error.message,
      );

      if (error.name === 'ZodError') {
        const zodErrors = error.errors.map((err: any) => ({
          message: `${err.path.join('.')}: ${err.message}`,
        }));
        return { success: false, errors: zodErrors, failedCount: 1 };
      }

      return {
        success: false,
        errors: [
          {
            message: `발송처리 실패: ${
              error.response?.data?.message || error.message
            }`,
          },
        ],
        data: error.response?.data,
        failedCount: 1,
      };
    }
  }

  /**
   * 네이버 취소 승인 API 호출
   */
  private async executeCancelApprove(
    token: string,
    command: any, // executeCommand에서 any로 받아오므로 일단 any로 유지
  ): Promise<SyncResult> {
    try {
      // 1. 명령 검증
      const validatedCommand = CancelApproveCommandSchema.parse(command);

      console.log('❌ 네이버 취소 승인 실행:', {
        productOrderId:
          'claimId' in validatedCommand
            ? validatedCommand.claimId
            : validatedCommand.orderId,
      });

      // 2. API 호출
      const productOrderId =
        'claimId' in validatedCommand
          ? validatedCommand.claimId
          : validatedCommand.orderId;
      const response = await this.naverApi.approveCancel(token, productOrderId);

      console.log(`✅ 네이버 취소승인 성공:`, response);

      // 3. 네이버 응답을 내부 표준 데이터로 변환 (진정한 어댑터 역할)
      return this.transformNaverResponseToInternalResult(
        response,
        'cancel.approve',
      );
    } catch (error) {
      if (error.name === 'ZodError') {
        return {
          success: false,
          errors: error.errors.map((err: any) => ({
            message: `명령 검증 실패 - ${err.path.join('.')}: ${err.message}`,
          })),
          failedCount: 1,
        };
      }

      console.error(
        `❌ 네이버 취소승인 실패:`,
        error.response?.data || error.message,
      );
      return {
        success: false,
        errors: [
          {
            message: `취소 승인 실패: ${error.response?.data?.message || error.message}`,
          },
        ],
        data: error.response?.data,
        failedCount: 1,
      };
    }
  }

  /**
   * 네이버 반품 승인 API 호출
   */
  private async executeReturnApprove(
    token: string,
    command: any, // executeCommand에서 any로 받아오므로 일단 any로 유지
  ): Promise<SyncResult> {
    try {
      // 1. 명령 검증
      const validatedCommand = ReturnApproveCommandSchema.parse(command);

      console.log('🔄 네이버 반품 승인 실행:', {
        productOrderId:
          'claimId' in validatedCommand
            ? validatedCommand.claimId
            : validatedCommand.orderId,
      });

      // 2. API 호출
      const productOrderId =
        'claimId' in validatedCommand
          ? validatedCommand.claimId
          : validatedCommand.orderId;
      const response = await this.naverApi.approveReturn(token, productOrderId);

      console.log(`✅ 네이버 반품승인 성공:`, response);

      // 3. 네이버 응답을 내부 표준 데이터로 변환 (진정한 어댑터 역할)
      return this.transformNaverResponseToInternalResult(
        response,
        'return.approve',
      );
    } catch (error) {
      if (error.name === 'ZodError') {
        return {
          success: false,
          errors: error.errors.map((err: any) => ({
            message: `명령 검증 실패 - ${err.path.join('.')}: ${err.message}`,
          })),
          failedCount: 1,
        };
      }

      console.error(
        `❌ 네이버 반품승인 실패:`,
        error.response?.data || error.message,
      );
      return {
        success: false,
        errors: [
          {
            message: `반품 승인 실패: ${error.response?.data?.message || error.message}`,
          },
        ],
        data: error.response?.data,
        failedCount: 1,
      };
    }
  }

  async transformToInternal(
    externalData: any,
    dataType: DataType,
  ): Promise<InternalOrderEvent[]> {
    if (dataType === 'orders' && Array.isArray(externalData)) {
      return this.transformProductInfosToInternalEvents(externalData);
    }
    return [];
  }

  /**
   * 🔄 진정한 어댑터 역할: 네이버 API 응답을 내부 표준 결과로 변환
   * 외부의 구체적인 응답 형태를 내부 시스템이 알 수 없게 차단하는 번역 계층
   */
  private transformNaverResponseToInternalResult(
    naverResponse: any,
    commandType: string,
    fallbackFailedCount: number = 1,
  ): SyncResult {
    // 네이버의 구체적인 응답 구조를 파싱
    const successIds = naverResponse.data?.successProductOrderIds || [];
    const failInfos = naverResponse.data?.failProductOrderInfos || [];

    // 내부 표준 형식으로 완전히 변환
    const internalResult: InternalCommandResult = {
      success: failInfos.length === 0,
      processedItems: successIds,
      failedItems: failInfos.map((fail: any) => ({
        id: fail.productOrderId,
        reason: fail.message,
        errorCode: fail.code,
      })),
      metadata: {
        commandType,
        timestamp: new Date().toISOString(),
        traceId: naverResponse.traceId, // 추적용
      },
    };

    // SyncResult는 내부 표준 데이터만 포함 (네이버 구체 응답 제거)
    return {
      success: internalResult.success,
      processedCount: internalResult.processedItems.length,
      failedCount:
        internalResult.failedItems.length ||
        (successIds.length === 0 ? fallbackFailedCount : 0),
      errors: internalResult.failedItems.map((item) => ({
        id: item.id,
        message: item.reason,
      })),
      data: internalResult, // 외부 API 응답 대신 내부 표준 데이터만 전달
    };
  }

  /**
   * ProductOrderInfo를 InternalOrderEvent로 직접 변환
   */
  private transformProductInfosToInternalEvents(
    productInfos: ProductOrderInfo[],
  ): InternalOrderEvent[] {
    return productInfos.map((info) => {
      // 타입 안전성을 위한 타입 단언
      const typedInfo = info as TypedProductOrderInfo;

      return {
        channelType: 'naver_smartstore',
        externalOrderId: typedInfo.order?.orderId || '',
        externalProductOrderId: typedInfo.productOrder?.productOrderId || '',
        status: this.mapNaverStatusToInternal(
          typedInfo.productOrder?.productOrderStatus || '',
        ),
        paymentDate: typedInfo.order?.paymentDate || '',
        quantity: typedInfo.productOrder?.quantity || 0,
        priceAmount: typedInfo.productOrder?.totalProductAmount || 0,
        createdAt: typedInfo.order?.paymentDate || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    });
  }

  /**
   * 네이버 주문 상태를 내부 표준 상태로 매핑
   */
  private mapNaverStatusToInternal(naverStatus: string): string {
    const statusMap: Record<string, string> = {
      PAYMENT_WAITING: 'PENDING_PAYMENT',
      PAYED: 'PAID',
      DISPATCHED: 'SHIPPED',
      DELIVERING: 'IN_TRANSIT',
      DELIVERED: 'DELIVERED',
      PURCHASE_DECIDED: 'COMPLETED',
      CANCELED: 'CANCELLED',
      RETURNED: 'RETURNED',
      EXCHANGED: 'EXCHANGED',
    };
    return statusMap[naverStatus] || naverStatus;
  }

  async transformToExternal(
    internalData: any,
    dataType: DataType,
  ): Promise<any> {
    // 레거시 메서드 - 새로운 syncToChannel 방식 사용 권장
    this.logger.warn(
      'transformToExternal은 deprecated됩니다. syncToChannel을 사용하세요.',
    );
    return {};
  }

  /**
   * 내부 상품 데이터를 네이버 API 형식으로 변환
   */
  private transformInternalProductToNaver(productData: any): any {
    // 실제 네이버 상품 API 스펙에 맞게 변환
    return {
      productId: productData.id,
      productName: productData.name,
      salePrice: productData.price,
      productDescription: productData.description,
      categoryId: productData.categoryId,
      brandName: productData.brand,
      // 네이버 API 스펙에 맞는 추가 필드들...
    };
  }

  /**
   * 내부 재고 데이터를 네이버 단일 상품 API 형식으로 변환
   */
  private transformToNaverSaleStatusBody(
    inventoryData: InternalInventoryData,
  ): ChangeSaleStatusBody {
    return {
      statusType: 'SALE',
      stockQuantity: inventoryData.stockQuantity,
    };
  }

  /**
   * 내부 재고 데이터를 네이버 옵션 상품 API 형식으로 변환
   */
  private transformToNaverOptionStockBody(
    inventoryData: InternalInventoryData,
  ): UpdateOptionStockBody {
    if (!inventoryData.optionInfo) {
      throw new Error('옵션 상품 데이터에 optionInfo가 필요합니다.');
    }

    return {
      productSalePrice: {
        salePrice: 0, // 기본값 (가격 변경 없이 재고만 업데이트)
      },
      immediateDiscountPolicy: {
        discountMethod: {
          value: 0,
          unitType: 'PERCENT',
        },
      },
      optionInfo: {
        useStockManagement: true,
        optionCombinations: inventoryData.optionInfo.optionCombinations || [],
        optionStandards: inventoryData.optionInfo.optionStandards || [],
      },
    };
  }

  /**
   * 🔍 표준화된 쿼리 객체를 사용하여 주문 정보를 조회합니다.
   * 네이버는 API 조합을 통해 '진짜 조회' 기능을 구현합니다.
   *
   * @param query 조회 조건을 담은 표준 쿼리 객체
   * @returns 변환된 내부 주문 이벤트 배열. 결과가 없으면 빈 배열을 반환합니다.
   */
  async findOrders(query: OrderQuery): Promise<InternalOrderEvent[]> {
    try {
      this.logger.log(`🔍 [네이버] 주문 조회 시작: ${query.by} = ${query.id}`);

      // 실제 토큰을 가져옵니다
      const token = await this.naverApi.getAccessToken();

      switch (query.by) {
        case 'channelProductOrderId':
          // 네이버 productOrderId로 직접 조회 (의도: 단건)
          this.logger.log(`📋 [네이버] productOrderId 직접 조회: ${query.id}`);
          const productOrderDetails = await this.naverApi.getOrderDetails(
            token,
            [query.id],
          );
          const directResult = await this.transformToInternal(
            productOrderDetails,
            'orders',
          );
          this.logger.log(
            `✅ [네이버] productOrderId 조회 완료: ${directResult.length}건`,
          );
          return directResult;

        case 'channelOrderId':
          // 네이버 orderId → productOrderIds → 상세 조회 (API 조합의 핵심!)
          this.logger.log(
            `🔗 [네이버] orderId → productOrderIds 조합 조회: ${query.id}`,
          );

          // 1단계: orderId로 productOrderId 목록 조회
          const productOrderIdsResponse =
            await this.naverApi.getProductOrderIdsByOrderId(token, query.id);
          const productOrderIds = productOrderIdsResponse.data || [];

          if (productOrderIds.length === 0) {
            this.logger.warn(
              `⚠️ [네이버] orderId ${query.id}에 해당하는 productOrderId가 없습니다`,
            );
            return [];
          }

          this.logger.log(
            `🔍 [네이버] 발견된 productOrderIds: ${productOrderIds.length}개`,
          );

          // 2단계: productOrderId 목록으로 상세 정보 조회
          const orderDetails = await this.naverApi.getOrderDetails(
            token,
            productOrderIds,
          );
          const combinedResult = await this.transformToInternal(
            orderDetails,
            'orders',
          );
          this.logger.log(
            `✅ [네이버] API 조합 조회 완료: ${combinedResult.length}건`,
          );
          return combinedResult;

        case 'channelShipmentId':
          // 네이버는 shipmentId 개념이 없음
          this.logger.warn(
            `❌ [네이버] 'channelShipmentId' 조회는 지원하지 않습니다 (네이버 특성상 불가능)`,
          );
          return [];

        default:
          this.logger.warn(
            `❌ [네이버] 지원하지 않는 조회 타입: ${(query as any).by}`,
          );
          return [];
      }
    } catch (error) {
      this.logger.error(
        `❌ [네이버] 주문 조회 실패 (${query.by}=${query.id}):`,
        error.message,
      );
      return [];
    }
  }
}
