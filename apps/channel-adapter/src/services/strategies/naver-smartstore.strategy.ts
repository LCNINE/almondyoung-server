import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ChannelStrategy } from './channel-strategy.interface';
import { DataType, SyncResult } from '../../types';
import { InternalOrderEvent } from '../../types';
import { ChannelCommand } from '../../types';
import { firstValueFrom } from 'rxjs';
import * as bcrypt from 'bcrypt';
import {
  InternalDispatchCommandSchema,
  transformInternalCommandToNaverRequest,
  NaverDispatchRequestSchema,
} from '../../zods/naver-dispatch.zod';
import { NaverCommerceApiService } from '../apis/naver-commerce.api.service';

import {
  NaverLastChangedStatusResponse,
  ProductOrderInfo,
  DelayDispatchBody,
} from '../apis/naver-commerce.api.service';

// 주문 상세 정보 응답 타입 (간소화된 버전)
interface NaverOrderDetail {
  orderId: string;
  productOrderId: string;
  productOrderStatus: string;
  paymentDate: string;
  quantity: number;
  totalProductAmount: number;
}

@Injectable()
export class NaverSmartstoreStrategy implements ChannelStrategy {
  private readonly logger = new Logger(NaverSmartstoreStrategy.name);
  constructor(private readonly naverApi: NaverCommerceApiService) {}

  async processIncomingEvent(event: any): Promise<InternalOrderEvent[]> {
    // 네이버 웹훅이 있는 경우 payload -> InternalOrderEvent로 변환
    return this.transformToInternal(event, 'orders');
  }

  async syncFromChannel(dataType: DataType): Promise<InternalOrderEvent[]> {
    if (dataType !== 'orders') {
      console.log(`Skipping unsupported dataType: ${dataType}`);
      return [];
    }

    try {
      const token = await this.naverApi.getAccessToken();
      const lastChangedFrom = new Date(
        Date.now() - 24 * 60 * 60 * 1000,
      ).toISOString();

      console.log(
        `📡 네이버 주문 상태 변경 내역 조회 시작 (${lastChangedFrom} 이후)`,
      );

      // 1. 변경된 주문 상태 목록 조회
      const statusResponse = await this.naverApi.getLastChangedStatuses(
        token,
        lastChangedFrom,
      );

      const statusChanges = statusResponse.data?.lastChangeStatuses || [];
      console.log(`📋 변경된 주문 상태 ${statusChanges.length}건 조회됨`);

      if (statusChanges.length === 0) {
        return [];
      }

      const productOrderIds = statusChanges.map(
        (status) => status.productOrderId,
      );

      // 2. 상세 주문 정보 조회
      console.log(`🔍 상세 주문 정보 조회 대상: ${productOrderIds.length}건`);
      const detailsResponse = await this.naverApi.getOrderDetails(
        token,
        productOrderIds,
      );

      const orderDetails = detailsResponse.data || [];
      console.log(`✅ 상세 주문 정보 ${orderDetails.length}건 조회 완료`);

      // 3. ProductOrderInfo를 NaverOrderDetail로 변환 후 내부 이벤트 형식으로 변환
      const naverOrderDetails =
        this.convertProductOrderInfoToNaverOrderDetail(orderDetails);
      return this.transformOrderDetailsToInternal(naverOrderDetails);
    } catch (error) {
      console.error(
        '❌ 네이버 주문 동기화 실패:',
        error.response?.data || error.message,
      );
      throw new Error(`네이버 주문 동기화 실패: ${error.message}`);
    }
  }

  async syncToChannel(data: any, dataType: DataType): Promise<SyncResult> {
    // 내부 데이터 -> 네이버 전송 로직 (예: 상품 정보 업데이트)
    return { success: true };
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
    command: any,
  ): Promise<SyncResult> {
    console.log('✅ 네이버 발주확인 실행:', {
      productOrderIds: command.productOrderIds,
    });

    try {
      const response = await this.naverApi.confirmOrders(
        token,
        command.productOrderIds,
      );

      const successIds = response.data?.successProductOrderIds || [];
      const failInfos = response.data?.failProductOrderInfos || [];

      console.log(
        `✅ 네이버 발주확인 완료: 성공 ${successIds.length}건, 실패 ${failInfos.length}건`,
      );

      const errors = failInfos.map((fail: any) => ({
        message: `[${fail.productOrderId}] ${fail.code}: ${fail.message}`,
      }));

      return {
        success: failInfos.length === 0,
        data: response,
        processedCount: successIds.length,
        failedCount: failInfos.length,
        errors: errors,
      };
    } catch (error) {
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
        failedCount: command.productOrderIds.length,
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
    command: any,
  ): Promise<SyncResult> {
    const { productOrderId, dispatchDueDate, reasonCode, reasonText } = command;

    console.log('⏳ 네이버 발송지연 처리 실행:', {
      productOrderId,
      dispatchDueDate,
      reasonCode,
    });

    try {
      // API 명세에 맞는 요청 본문 생성
      const requestBody = {
        dispatchDueDate,
        delayedDispatchReason: reasonCode,
        dispatchDelayedDetailedReason: reasonText,
      };

      const response = await this.naverApi.delayDispatch(
        token,
        productOrderId,
        requestBody,
      );

      const successIds = response.data?.successProductOrderIds || [];
      const failInfos = response.data?.failProductOrderInfos || [];
      const isSuccess = successIds.length > 0 && failInfos.length === 0;

      if (isSuccess) {
        console.log(`✅ [${productOrderId}] 네이버 발송지연 처리 성공`);
      } else {
        console.warn(`⚠️ [${productOrderId}] 네이버 발송지연 처리 실패`, {
          failInfos,
        });
      }

      return {
        success: isSuccess,
        data: response,
        processedCount: successIds.length,
        failedCount: failInfos.length,
        errors: failInfos.map((fail: any) => ({
          message: `[${fail.productOrderId}] ${fail.code}: ${fail.message}`,
        })),
      };
    } catch (error) {
      this.logger.error(
        `❌ [${productOrderId}] 네이버 발송지연 처리 API 호출 실패:`,
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

      return {
        success: true,
        data: response,
        processedCount: validatedNaverRequest.dispatchProductOrders.length,
      };
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
    command: any,
  ): Promise<SyncResult> {
    console.log('❌ 네이버 취소 승인 실행:', {
      orderId: command.orderId,
      claimId: command.claimId,
    });

    try {
      const productOrderId = command.claimId || command.orderId;
      const response = await this.naverApi.approveCancel(token, productOrderId);

      console.log(`✅ 네이버 취소승인 성공:`, response);

      return { success: true, data: response, processedCount: 1 };
    } catch (error) {
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
    command: any,
  ): Promise<SyncResult> {
    console.log('🔄 네이버 반품 승인 실행:', {
      orderId: command.orderId,
      claimId: command.claimId,
    });

    try {
      const productOrderId = command.claimId || command.orderId;
      const response = await this.naverApi.approveReturn(token, productOrderId);

      console.log(`✅ 네이버 반품승인 성공:`, response);

      return { success: true, data: response, processedCount: 1 };
    } catch (error) {
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
      return this.transformOrderDetailsToInternal(externalData);
    }
    return [];
  }

  /**
   * ProductOrderInfo를 NaverOrderDetail로 변환
   */
  private convertProductOrderInfoToNaverOrderDetail(
    productOrderInfos: ProductOrderInfo[],
  ): NaverOrderDetail[] {
    return productOrderInfos.map((info) => ({
      orderId: (info.order as any)?.orderId || '',
      productOrderId: (info.productOrder as any)?.productOrderId || '',
      productOrderStatus: (info.productOrder as any)?.productOrderStatus || '',
      paymentDate: (info.order as any)?.paymentDate || '',
      quantity: (info.productOrder as any)?.quantity || 0,
      totalProductAmount: (info.productOrder as any)?.totalProductAmount || 0,
    }));
  }

  /**
   * 네이버 상세 주문 정보를 InternalOrderEvent로 변환
   */
  private transformOrderDetailsToInternal(
    orderDetails: NaverOrderDetail[],
  ): InternalOrderEvent[] {
    return orderDetails.map((detail) => ({
      channelType: 'naver_smartstore',
      externalOrderId: detail.orderId,
      externalProductOrderId: detail.productOrderId,
      status: this.mapNaverStatusToInternal(detail.productOrderStatus),
      paymentDate: detail.paymentDate,
      quantity: detail.quantity,
      priceAmount: detail.totalProductAmount,
      createdAt: detail.paymentDate,
      updatedAt: new Date().toISOString(),
      // lastChangedType 등은 last-changed-statuses 응답과 조합해야 할 수 있습니다.
    }));
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
    // 내부 데이터 -> 네이버 형식 변환 로직
    return {};
  }
}
