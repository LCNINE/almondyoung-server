import { Injectable, Logger, BadRequestException } from '@nestjs/common';
// import { HttpService } from '@nestjs/axios'; // BaseClient로 이동
import { ChannelAdapter } from '../channel-adapter.interface';
import { DataType, SyncResult, SyncToChannelPayload, InternalInventoryData } from '../../types';
import { InternalOrderEvent, OrderQuery } from '../../types';
import { ChannelCommand, ChannelQuery } from '../../types';

// -----------------------------------------------------------------
// 1. Zod Import 경로 변경 ( .ts 확장자 제거 및 경로 수정 )
// -----------------------------------------------------------------
import { z } from 'zod';

// API 클라이언트 Import (리팩토링된 파일)

// import { NaverAuthService } from '../apis/naver-auth.service'; // 제거
import { OrderEventPublisher } from '../../services/order-event.publisher';
import { PendingOrderService } from '../../services/pending-order.service';

// 신규 Zod 스키마 Import
import {
  DeliveryCompanyCode,
  DeliveryMethod,
  DeliveryMethodSchema,
  DeliveryCompanyCodeSchema,
  NaverClaimProcessResponse, // naver-core.zod.ts에서 가져옴
} from '../../zods/naver/naver-core.zod'; // .zod 제거, naver.core -> naver-core
import {
  DelayDispatchBody,
  DispatchProductOrder,
  NaverDispatchRequest,
  NaverLastChangedStatusResponse,
  NaverProductOrderDetailsResponse,
  NaverProductOrderIdsResponse,
  DispatchProductOrderSchema,
  DelayDispatchBodySchema,
} from '../../zods/naver/naver.order.zod'; // .zod.ts 제거
import {} from // ApproveReturnBody, // 존재하지 않는 import 제거
// ApproveCancelBody, // 존재하지 않는 import 제거
'../../zods/naver/naver.claim.zod'; // .zod.ts 제거
import {
  ChangeSaleStatusBody,
  UpdateOptionStockBody,
  ChangeSaleStatusBodySchema,
  UpdateOptionStockBodySchema,
} from '../../zods/naver/naver.product.zod'; // .zod.ts 제거
import { NaverOrderClient } from './clients/naver-order.client';
import { NaverClaimClient } from './clients/naver-claim.client';
import { NaverProductClient } from './clients/naver-product.client';
import {
  CancelApproveCommandSchema,
  DispatchDelayCommandSchema,
  OrderConfirmCommandSchema,
  ReturnApproveCommandSchema,
} from '../../zods/naver/naver-adapter.zod';

// -----------------------------------------------------------------
// 2. naver-dispatch.zod.ts에서 내부 변환 로직 이전
// -----------------------------------------------------------------

/**
 * 내부 발송 명령 스키마 (Adapter 전용)
 */
const InternalDispatchCommandSchema = z.object({
  type: z.literal('dispatch.ship'), // executeCommand와 일치시킴
  orderId: z.string(),
  productOrderIds: z.array(z.string()).optional(),
  productOrderId: z.string().optional(), // 단일 상품 주문의 경우
  tracking: z.object({
    companyCode: z.string(),
    number: z.string(),
  }),
  dispatchedAt: z.iso.datetime().optional(),
});
type InternalDispatchCommand = z.infer<typeof InternalDispatchCommandSchema>;

/**
 * 택배사 코드를 네이버 API 형식으로 매핑 (Adapter 전용)
 */
const DELIVERY_COMPANY_MAPPING: Record<string, DeliveryCompanyCode> = {
  CJ: 'CJGLS',
  LOTTE: 'HYUNDAI',
  HANJIN: 'HANJIN',
  LOGEN: 'KGB',
  EPOST: 'EPOST',
  CU: 'CUPARCEL',
  DHL: 'DHL',
  FEDEX: 'FEDEX',
  UPS: 'UPS',
  EMS: 'EMS',
  DEFAULT: 'CJGLS', // 기본값
};

/**
 * 내부 명령을 네이버 API 요청으로 변환하는 헬퍼 함수 (Adapter 전용)
 */
function transformInternalCommandToNaverRequest(command: InternalDispatchCommand): NaverDispatchRequest {
  // productOrderIds 결정 (배열 또는 단일 값)
  const productOrderIds = command.productOrderIds || (command.productOrderId ? [command.productOrderId] : []);

  if (productOrderIds.length === 0) {
    throw new Error('productOrderIds 또는 productOrderId가 필요합니다');
  }

  // 택배사 코드 매핑
  const deliveryCompanyCode =
    DELIVERY_COMPANY_MAPPING[command.tracking.companyCode] || DELIVERY_COMPANY_MAPPING.DEFAULT;

  // 배송일 설정 (기본값: 현재 시간)
  const dispatchDate = command.dispatchedAt || new Date().toISOString();

  // Zod 스키마를 사용하여 개별 dispatchProductOrder 객체 생성
  const dispatchOrders: DispatchProductOrder[] = productOrderIds.map((productOrderId) =>
    DispatchProductOrderSchema.parse({
      productOrderId,
      deliveryMethod: 'DELIVERY' as const,
      deliveryCompanyCode,
      trackingNumber: command.tracking.number,
      dispatchDate,
    }),
  );

  return {
    dispatchProductOrders: dispatchOrders,
  };
}
// -----------------------------------------------------------------
// 끝: 내부 변환 로직 이전
// -----------------------------------------------------------------

// ProductOrderInfo 타입 임시 정의 (원래 naver-api.zod.ts에 있던 것)
// TODO: 이 타입도 응답 스키마와 함께 naver.order.zod.ts로 이동하는 것이 좋음
interface ProductOrderInfo {
  order: any;
  productOrder: any;
  cancel?: any;
  return?: any;
  exchange?: any;
  beforeClaim: object;
  currentClaim: any;
  completedClaims: any[];
  delivery: any;
}

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

/**
 * 네이버 스마트스토어 채널 어댑터
 *
 * 네이버 커머스 API의 특수한 인터페이스를 내부 표준 인터페이스로 변환합니다.
 * 어댑터 패턴을 적용하여 네이버 API 호출 방식을 내부 시스템에 적응시킵니다.
 */
@Injectable()
export class NaverSmartstoreAdapter implements ChannelAdapter {
  private readonly logger = new Logger(NaverSmartstoreAdapter.name);

  // -----------------------------------------------------------------
  // 3. 생성자(Constructor) 수정
  // -----------------------------------------------------------------
  constructor(
    private readonly naverOrderClient: NaverOrderClient,
    private readonly naverClaimClient: NaverClaimClient,
    private readonly naverProductClient: NaverProductClient,
    private readonly orderEventPublisher: OrderEventPublisher,
    private readonly pendingOrderService: PendingOrderService,
  ) {}

  async processIncomingEvent(event: any): Promise<InternalOrderEvent[]> {
    // 네이버 웹훅이 있는 경우 payload -> InternalOrderEvent로 변환
    return this.transformToInternal(event, 'orders');
  }

  /**
   * 🔄 수신(Inbound) 동기화: 네이버에서 변경된 주문 정보를 가져와 내부 표준 이벤트로 변환
   */
  async syncFromChannel(dataType: DataType): Promise<InternalOrderEvent[]> {
    if (dataType !== 'orders') {
      this.logger.warn(`지원하지 않는 dataType: ${dataType}. 'orders'만 지원됩니다.`);
      return [];
    }

    try {
      // 1. 인증 토큰 획득 (제거) - NaverOrderClient가 내부 처리
      // 2. 조회 시작 시점 설정 (지난 24시간)
      const lastChangedFrom = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      this.logger.log(`📡 네이버 주문 상태 변경 내역 조회 시작 (${lastChangedFrom} 이후)`);

      // 3. 최근 변경된 주문 상태 목록 조회 (naverOrderClient 사용)
      const statusResponse = await this.naverOrderClient.getLastChangedStatuses(lastChangedFrom);

      const statusChanges = statusResponse.data?.lastChangeStatuses || [];
      this.logger.log(`📋 변경된 주문 상태 ${statusChanges.length}건 조회됨`);

      if (statusChanges.length === 0) {
        this.logger.log('📭 변경된 주문이 없습니다.');
        return [];
      }

      // 4. productOrderId 목록 추출
      const productOrderIds = statusChanges.map((status) => status.productOrderId);

      // 5. 상세 주문 정보 조회 (naverOrderClient 사용)
      this.logger.log(`🔍 상세 주문 정보 조회 대상: ${productOrderIds.length}건`);
      const detailsResponse = await this.naverOrderClient.getOrderDetails(productOrderIds);

      const orderDetails: NaverProductOrderDetailsResponse['data'] = detailsResponse.data || [];
      this.logger.log(`✅ 상세 주문 정보 ${orderDetails.length}건 조회 완료`);

      // 6. 네이버 형식을 내부 표준 이벤트 형식으로 변환 (진정한 어댑터 역할)
      const internalEvents = this.transformProductInfosToInternalEvents(
        orderDetails as any, // ProductOrderInfo 타입 사용
      );

      this.logger.log(`🎯 내부 이벤트 변환 완료: ${internalEvents.length}건`);

      // 7. 주문 이벤트 발행 (WMS로 전달)
      await this.publishOrderEvents(internalEvents);

      return internalEvents;
    } catch (error) {
      this.logger.error('❌ 네이버 주문 동기화 실패:', error.response?.data || error.message);
      throw new Error(`네이버 주문 동기화 실패: ${error.message}`);
    }
  }

  /**
   * 🔄 송신(Outbound) 동기화: 내부 시스템의 변경사항을 네이버 스마트스토어로 전송
   */
  async syncToChannel(payload: SyncToChannelPayload): Promise<SyncResult> {
    try {
      // 토큰 획득 로직 제거 (ProductClient가 내부 처리)

      switch (payload.dataType) {
        case 'products': {
          const productData = payload.payload;
          console.log(`📦 네이버 상품 정보 동기화: ${productData.name} (${productData.id})`);
          const naverProductData = this.transformInternalProductToNaver(productData);
          // TODO: await this.naverProductClient.updateProduct(naverProductData);
          console.log(`✅ 네이버 상품 정보 동기화 완료: ${productData.id}`);
          return {
            success: true,
            processedCount: 1,
            data: { productId: productData.id, syncType: 'product_update' },
          };
        }

        case 'inventory': {
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
              const saleStatusBody = this.transformToNaverSaleStatusBody(inventoryData);
              this.logger.log(`🔄 단일 상품 재고 업데이트 API 호출 중...`);
              // naverProductClient 사용
              response = await this.naverProductClient.changeSaleStatus(originProductNo, saleStatusBody);
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
              const optionStockBody = this.transformToNaverOptionStockBody(inventoryData);
              this.logger.log(`🔄 옵션 상품 재고 업데이트 API 호출 중...`);
              // naverProductClient 사용
              response = await this.naverProductClient.updateOptionStock(originProductNo, optionStockBody);
              this.logger.log(`✅ 옵션 상품 재고 업데이트 성공:`, response);
            }

            return {
              success: true,
              processedCount: 1,
              data: {
                productId: inventoryData.productId,
                syncType: inventoryData.isOptionProduct ? 'option_inventory_update' : 'single_inventory_update',
                response: response,
              },
            };
          } catch (apiError: any) {
            if (apiError instanceof BadRequestException) {
              throw apiError;
            }
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
          const orderStatusData = payload.payload;
          console.log(`📦 네이버 주문 상태 동기화: ${orderStatusData.orderId} → ${orderStatusData.status}`);
          // TODO: 로직 구현
          console.log(`✅ 네이버 주문 상태 동기화 완료: ${orderStatusData.orderId}`);
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
      // 토큰 획득 로직 제거 (각 Client가 내부 처리)

      switch (command.type) {
        case 'order.prepare':
          return await this.executeOrderConfirm(command);

        case 'dispatch.ship':
          return await this.executeDispatchConfirm(command);

        case 'dispatch.delay':
          return await this.executeDispatchDelay(command);

        case 'order.cancel':
          return await this.executeCancelApprove(command);

        case 'return.approve':
          return await this.executeReturnApprove(command);

        default:
          return {
            success: false,
            errors: [{ message: `네이버에서 지원하지 않는 명령: ${command.type}` }],
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

  async executeQuery(query: ChannelQuery): Promise<any> {
    try {
      switch (query.type) {
        case 'order.status':
          return await this.queryOrderStatus(query);

        case 'claim.details':
          return await this.queryClaimDetails(query);

        default:
          throw new Error(`네이버에서 지원하지 않는 조회: ${query.type}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`네이버 조회 실행 실패: ${message}`);
    }
  }

  // 간단한 조회 메서드들
  private async queryOrderStatus(query: { type: 'order.status'; orderId: string }): Promise<any> {
    // TODO: 네이버 주문 상태 조회 구현
    throw new Error('구현 필요: 네이버 주문 상태 조회');
  }

  private async queryClaimDetails(query: { type: 'claim.details'; claimId: string }): Promise<any> {
    // TODO: 네이버 클레임 상세 조회 구현
    throw new Error('구현 필요: 네이버 클레임 상세 조회');
  }

  /**
   * 네이버 발주확인 API 호출
   */
  private async executeOrderConfirm(command: any): Promise<SyncResult> {
    try {
      // 1. 명령 검증 및 타입 변환
      const validatedCommand = OrderConfirmCommandSchema.parse(command);
      console.log('✅ 네이버 발주확인 실행:', {
        productOrderIds: validatedCommand.productOrderIds,
      });

      // 2. API 호출 (naverOrderClient 사용)
      const response = await this.naverOrderClient.confirmOrders(validatedCommand.productOrderIds);

      console.log(
        `✅ 네이버 발주확인 완료: 성공 ${response.data?.successProductOrderIds?.length || 0}건, 실패 ${response.data?.failProductOrderInfos?.length || 0}건`,
      );

      // 3. 네이버 응답을 내부 표준 데이터로 변환
      return this.transformNaverResponseToInternalResult(
        response,
        'order.confirm',
        validatedCommand.productOrderIds.length,
      );
    } catch (error) {
      if (error instanceof z.ZodError) {
        // -----------------------------------------------------------------
        // 5. Zod 에러 핸들링 수정 (error.errors -> error.issues)
        // -----------------------------------------------------------------
        return {
          success: false,
          errors: error.issues.map((issue) => ({
            message: `명령 검증 실패 - ${issue.path.join('.')}: ${issue.message}`,
          })),
          failedCount: 1,
        };
      }

      console.error(`❌ 네이버 발주확인 실패:`, error.response?.data || error.message);
      return {
        success: false,
        errors: [
          {
            message: `발주확인 API 호출 실패: ${error.response?.data?.message || error.message}`,
          },
        ],
        data: error.response?.data,
        failedCount: 1,
      };
    }
  }

  /**
   * 🆕 네이버 발송지연 처리 API 호출
   */
  private async executeDispatchDelay(command: any): Promise<SyncResult> {
    try {
      // 1. 명령 검증
      const validatedCommand = DispatchDelayCommandSchema.parse(command);
      console.log('⏳ 네이버 발송지연 처리 실행:', {
        productOrderId: validatedCommand.productOrderId,
        dispatchDueDate: validatedCommand.dispatchDueDate,
        reasonCode: validatedCommand.reasonCode,
      });

      // 2. API 명세에 맞는 요청 본문 생성 (Zod 스키마 사용)
      const requestBody: DelayDispatchBody = DelayDispatchBodySchema.parse({
        dispatchDueDate: validatedCommand.dispatchDueDate,
        delayedDispatchReason: validatedCommand.reasonCode,
        dispatchDelayedDetailedReason: validatedCommand.reasonText,
      });

      // 3. API 호출 (naverOrderClient 사용)
      const response = await this.naverOrderClient.delayDispatch(validatedCommand.productOrderId, requestBody);

      const isSuccess =
        response.data?.successProductOrderIds?.length > 0 && (response.data?.failProductOrderInfos?.length || 0) === 0;

      if (isSuccess) {
        console.log(`✅ [${validatedCommand.productOrderId}] 네이버 발송지연 처리 성공`);
      } else {
        console.warn(`⚠️ [${validatedCommand.productOrderId}] 네이버 발송지연 처리 실패`, {
          failInfos: response.data?.failProductOrderInfos,
        });
      }

      // 4. 네이버 응답을 내부 표준 데이터로 변환
      return this.transformNaverResponseToInternalResult(response, 'dispatch.delay');
    } catch (error) {
      if (error instanceof z.ZodError) {
        // -----------------------------------------------------------------
        // 5. Zod 에러 핸들링 수정 (error.errors -> error.issues)
        // -----------------------------------------------------------------
        return {
          success: false,
          errors: error.issues.map((issue) => ({
            message: `명령 검증 실패 - ${issue.path.join('.')}: ${issue.message}`,
          })),
          failedCount: 1,
        };
      }

      this.logger.error(`❌ 네이버 발송지연 처리 API 호출 실패:`, error.response?.data || error.message);
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
  private async executeDispatchConfirm(command: any): Promise<SyncResult> {
    console.log('📦 네이버 발송처리 실행:', {
      orderId: command.orderId,
      productOrderIds: command.productOrderIds,
      tracking: command.tracking,
    });

    try {
      // 1. 내부 명령 유효성 검사 및 네이버 API 형식으로 변환
      const validatedCommand = InternalDispatchCommandSchema.parse(command);
      const naverRequest = transformInternalCommandToNaverRequest(validatedCommand);

      // 2. API 호출 (naverOrderClient 사용)
      const response = await this.naverOrderClient.dispatchOrders(naverRequest.dispatchProductOrders);

      console.log('✅ 네이버 발송처리 성공:', response);

      // 네이버 응답을 내부 표준 데이터로 변환
      return this.transformNaverResponseToInternalResult(
        response,
        'dispatch.confirm',
        naverRequest.dispatchProductOrders.length,
      );
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      console.error('❌ 네이버 발송처리 실패:', error.response?.data || error.message);

      if (error instanceof z.ZodError) {
        // -----------------------------------------------------------------
        // 5. Zod 에러 핸들링 수정 (error.errors -> error.issues)
        // -----------------------------------------------------------------
        const zodErrors = error.issues.map((issue) => ({
          message: `${issue.path.join('.')}: ${issue.message}`,
        }));
        return { success: false, errors: zodErrors, failedCount: 1 };
      }

      return {
        success: false,
        errors: [
          {
            message: `발송처리 실패: ${error.response?.data?.message || error.message}`,
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
  private async executeCancelApprove(command: any): Promise<SyncResult> {
    try {
      // 1. 명령 검증
      const validatedCommand = CancelApproveCommandSchema.parse(command);
      console.log('❌ 네이버 취소 승인 실행:', {
        productOrderId: 'claimId' in validatedCommand ? validatedCommand.claimId : validatedCommand.orderId,
      });

      // 2. API 호출 (naverClaimClient 사용)
      const productOrderId = 'claimId' in validatedCommand ? validatedCommand.claimId : validatedCommand.orderId;
      const response = await this.naverClaimClient.approveCancel(productOrderId);

      console.log(`✅ 네이버 취소승인 성공:`, response);

      // 3. 네이버 응답을 내부 표준 데이터로 변환
      return this.transformNaverResponseToInternalResult(response, 'cancel.approve');
    } catch (error) {
      if (error instanceof z.ZodError) {
        // -----------------------------------------------------------------
        // 5. Zod 에러 핸들링 수정 (error.errors -> error.issues)
        // -----------------------------------------------------------------
        return {
          success: false,
          errors: error.issues.map((issue) => ({
            message: `명령 검증 실패 - ${issue.path.join('.')}: ${issue.message}`,
          })),
          failedCount: 1,
        };
      }

      console.error(`❌ 네이버 취소승인 실패:`, error.response?.data || error.message);
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
  private async executeReturnApprove(command: any): Promise<SyncResult> {
    try {
      // 1. 명령 검증
      const validatedCommand = ReturnApproveCommandSchema.parse(command);
      console.log('🔄 네이버 반품 승인 실행:', {
        productOrderId: 'claimId' in validatedCommand ? validatedCommand.claimId : validatedCommand.orderId,
      });

      // 2. API 호출 (naverClaimClient 사용)
      const productOrderId = 'claimId' in validatedCommand ? validatedCommand.claimId : validatedCommand.orderId;
      const response = await this.naverClaimClient.approveReturn(productOrderId);

      console.log(`✅ 네이버 반품승인 성공:`, response);

      // 3. 네이버 응답을 내부 표준 데이터로 변환
      return this.transformNaverResponseToInternalResult(response, 'return.approve');
    } catch (error) {
      if (error instanceof z.ZodError) {
        // -----------------------------------------------------------------
        // 5. Zod 에러 핸들링 수정 (error.errors -> error.issues)
        // -----------------------------------------------------------------
        return {
          success: false,
          errors: error.issues.map((issue) => ({
            message: `명령 검증 실패 - ${issue.path.join('.')}: ${issue.message}`,
          })),
          failedCount: 1,
        };
      }

      console.error(`❌ 네이버 반품승인 실패:`, error.response?.data || error.message);
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

  async transformToInternal(externalData: any, dataType: DataType): Promise<InternalOrderEvent[]> {
    if (dataType === 'orders' && Array.isArray(externalData)) {
      return this.transformProductInfosToInternalEvents(externalData);
    }
    return [];
  }

  /**
   * 🔄 진정한 어댑터 역할: 네이버 API 응답을 내부 표준 결과로 변환
   */
  private transformNaverResponseToInternalResult(
    naverResponse: NaverClaimProcessResponse, // naver-core.zod.ts의 공통 타입 사용
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
      failedItems: failInfos.map((fail) => ({
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

    // SyncResult는 내부 표준 데이터만 포함
    return {
      success: internalResult.success,
      processedCount: internalResult.processedItems.length,
      failedCount: internalResult.failedItems.length || (successIds.length === 0 ? fallbackFailedCount : 0),
      errors: internalResult.failedItems.map((item) => ({
        id: item.id,
        message: item.reason,
      })),
      data: internalResult,
    };
  }

  /**
   * ProductOrderInfo를 InternalOrderEvent로 직접 변환
   */
  private transformProductInfosToInternalEvents(productInfos: ProductOrderInfo[]): InternalOrderEvent[] {
    return productInfos.map((info) => {
      const typedInfo = info as TypedProductOrderInfo;
      const event: InternalOrderEvent = {
        channelType: 'naver_smartstore',
        externalOrderId: typedInfo.order?.orderId || '',
        externalProductOrderId: typedInfo.productOrder?.productOrderId || '',
        status: this.mapNaverStatusToInternal(typedInfo.productOrder?.productOrderStatus || ''),
        paymentDate: typedInfo.order?.paymentDate || '',
        quantity: typedInfo.productOrder?.quantity || 0,
        priceAmount: typedInfo.productOrder?.totalProductAmount || 0,
        createdAt: typedInfo.order?.paymentDate || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        // --- 추가된 필수/옵셔널 필드 (타입 정의에 따라 보강) ---
        lastChangedType: typedInfo.productOrder?.lastChangedType || 'UNKNOWN',
        lastChangedAt: typedInfo.productOrder?.lastChangedDate || new Date().toISOString(),
        // buyer, shippingAddress 등은 상세 스키마 확인 후 채워야 함
      };
      return event;
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

  async transformToExternal(internalData: any, dataType: DataType): Promise<any> {
    this.logger.warn('transformToExternal은 deprecated됩니다. syncToChannel을 사용하세요.');
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
      // ...
    };
  }

  /**
   * 내부 재고 데이터를 네이버 단일 상품 API 형식으로 변환
   */
  private transformToNaverSaleStatusBody(inventoryData: InternalInventoryData): ChangeSaleStatusBody {
    // naver.product.zod.ts의 ChangeSaleStatusBodySchema 사용
    return ChangeSaleStatusBodySchema.parse({
      statusType: 'SALE', // 재고 업데이트 시 SALE 고정
      stockQuantity: inventoryData.stockQuantity,
    });
  }

  /**
   * 내부 재고 데이터를 네이버 옵션 상품 API 형식으로 변환
   */
  private transformToNaverOptionStockBody(inventoryData: InternalInventoryData): UpdateOptionStockBody {
    if (!inventoryData.optionInfo) {
      throw new Error('옵션 상품 데이터에 optionInfo가 필요합니다.');
    }

    // naver.product.zod.ts의 UpdateOptionStockBodySchema 사용
    return UpdateOptionStockBodySchema.parse({
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
    });
  }

  /**
   * 🔍 표준화된 쿼리 객체를 사용하여 주문 정보를 조회합니다.
   */
  async findOrders(query: OrderQuery): Promise<InternalOrderEvent[]> {
    try {
      this.logger.log(`🔍 [네이버] 주문 조회 시작: ${query.by} = ${query.id}`);
      // 토큰 획득 로직 제거 (OrderClient가 내부 처리)

      switch (query.by) {
        case 'channelProductOrderId':
          this.logger.log(`📋 [네이버] productOrderId 직접 조회: ${query.id}`);
          const productOrderDetails = await this.naverOrderClient.getOrderDetails([query.id]);
          const directResult = await this.transformToInternal(
            productOrderDetails.data, // .data 추가
            'orders',
          );
          this.logger.log(`✅ [네이버] productOrderId 조회 완료: ${directResult.length}건`);
          return directResult;

        case 'channelOrderId':
          this.logger.log(`🔗 [네이버] orderId → productOrderIds 조합 조회: ${query.id}`);

          // 1단계: orderId로 productOrderId 목록 조회
          const productOrderIdsResponse = await this.naverOrderClient.getProductOrderIdsByOrderId(query.id);
          const productOrderIds = productOrderIdsResponse.data || [];

          if (productOrderIds.length === 0) {
            this.logger.warn(`⚠️ [네이버] orderId ${query.id}에 해당하는 productOrderId가 없습니다`);
            return [];
          }

          this.logger.log(`🔍 [네이버] 발견된 productOrderIds: ${productOrderIds.length}개`);

          // 2단계: productOrderId 목록으로 상세 정보 조회
          const orderDetails = await this.naverOrderClient.getOrderDetails(productOrderIds);
          const combinedResult = await this.transformToInternal(
            orderDetails.data, // .data 추가
            'orders',
          );
          this.logger.log(`✅ [네이버] API 조합 조회 완료: ${combinedResult.length}건`);
          return combinedResult;

        case 'channelShipmentId':
          this.logger.warn(`❌ [네이버] 'channelShipmentId' 조회는 지원하지 않습니다 (네이버 특성상 불가능)`);
          return [];

        default:
          this.logger.warn(`❌ [네이버] 지원하지 않는 조회 타입: ${(query as any).by}`);
          return [];
      }
    } catch (error) {
      this.logger.error(`❌ [네이버] 주문 조회 실패 (${query.by}=${query.id}):`, error.message);
      return [];
    }
  }

  /**
   * 주문 이벤트 발행
   *
   * 동기화된 주문들에 대해 상태에 따라 적절한 이벤트를 발행합니다.
   * - PAID/PENDING 상태: OrderCreated 이벤트 발행 (매핑 자동 조회, 미매핑 시 계류)
   * - CANCELLED 상태: OrderCancelled 이벤트 발행
   */
  private async publishOrderEvents(events: InternalOrderEvent[]): Promise<void> {
    let publishedCount = 0;
    let pendingCount = 0;

    for (const event of events) {
      try {
        switch (event.status) {
          case 'PENDING_PAYMENT':
          case 'PAID':
            // 새로운 주문 - 매핑 조회 후 OrderCreated 발행 또는 계류
            const result = await this.orderEventPublisher.publishOrderConfirmed('naver_smartstore', event);

            if (result.published) {
              publishedCount++;
            } else if (result.unmappedItems && result.unmappedItems.length > 0) {
              // 미매핑 항목 → 계류 처리
              await this.pendingOrderService.savePendingOrder('naver_smartstore', event, result.unmappedItems);
              pendingCount++;
            }
            break;

          case 'CANCELLED':
            // 취소된 주문 - OrderCancelled 발행
            await this.orderEventPublisher.publishOrderCancelled(
              'naver_smartstore',
              event,
              event.reason ?? 'CUSTOMER_REQUEST',
            );
            publishedCount++;
            break;

          default:
            this.logger.debug(`📋 [네이버] 이벤트 발행 스킵 (status=${event.status}): ${event.externalOrderId}`);
        }
      } catch (error) {
        this.logger.error(
          `❌ [네이버] 주문 이벤트 발행 실패: ${event.externalOrderId}`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    if (publishedCount > 0 || pendingCount > 0) {
      this.logger.log(`📤 [네이버] 주문 이벤트 처리 완료: ${publishedCount}건 발행, ${pendingCount}건 계류`);
    }
  }
}
