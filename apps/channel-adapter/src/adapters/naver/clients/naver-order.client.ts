import { Injectable, BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { z } from 'zod';
import { NaverBaseClient } from './naver-base.client';

// TODO: 추후 naver-api.types.ts 파일로 이동할 타입
import {
  ChangeHopeDeliveryBody,
  DelayDispatchBody,
  DispatchProductOrder,
  NaverLastChangedStatusResponse,
  NaverProductOrderDetailsResponse,
  NaverProductOrderIdsResponse,
  QueryProductOrdersParams,
  // Zod 스키마들
  DelayDispatchBodySchema,
  ChangeHopeDeliveryBodySchema,
  DispatchProductOrderSchema,
  QueryProductOrdersParamsSchema,
} from '../../../zods/naver/naver.order.zod';
import { NaverAuthService } from './naver-auth.client';
import { formatZodIssues } from '../../../shared/utils';

// TODO: 추후 naver-api.types.ts 파일로 이동할 공통 응답 타입
interface FailProductOrderInfo {
  productOrderId: string;
  code: string;
  message: string;
}
interface ClaimProcessResponseData {
  successProductOrderIds: string[];
  failProductOrderInfos: FailProductOrderInfo[];
}
export interface NaverClaimProcessResponse {
  timestamp: string;
  traceId: string;
  data: ClaimProcessResponseData;
}
// (타입 정의 끝)

@Injectable()
export class NaverOrderClient extends NaverBaseClient {
  constructor(
    protected readonly http: HttpService,
    private readonly authService: NaverAuthService,
  ) {
    // 부모 클래스(NaverBaseClient)의 생성자에 Logger 이름을 전달합니다.
    super(http, NaverOrderClient.name);
  }

  // =================================================================
  // == 발주 / 발송 처리 (Order / Dispatch)
  // =================================================================

  /**
   * 단수 또는 복수 개 상품 주문의 발주를 확인 처리합니다.
   * @param productOrderIds 발주 확인할 상품 주문 번호 배열
   * @returns API 응답 데이터
   */
  async confirmOrders(productOrderIds: string[]): Promise<NaverClaimProcessResponse> {
    const token = await this.authService.getAccessToken(); // 🔑 인증 서비스 사용
    const url = `${this.apiBaseUrl}/pay-order/seller/product-orders/confirm`;
    const response = await firstValueFrom(
      this.http.post<NaverClaimProcessResponse>(
        url,
        { productOrderIds },
        { headers: { Authorization: `Bearer ${token}` } },
      ),
    );
    return response.data;
  }
  /**
   * 단수 또는 복수 개 상품 주문을 발송 처리합니다.
   * @param dispatchProductOrders 발송 처리할 주문 정보 배열
   * @returns API 응답 데이터
   */
  async dispatchOrders(dispatchProductOrders: DispatchProductOrder[]): Promise<NaverClaimProcessResponse> {
    const token = await this.authService.getAccessToken(); // 🔑 인증 서비스 사용

    // 🎯 Zod 검증 추가 (배열 요소별 검증)
    const parsedOrders = z.array(DispatchProductOrderSchema).safeParse(dispatchProductOrders);
    if (!parsedOrders.success) {
      const flattenedErrors = parsedOrders.error.flatten();
      this.logger.error('❌ 발송 처리 요청 파라미터 검증 실패:', flattenedErrors);
      throw new BadRequestException({
        message: '발송 처리 요청 입력값 유효성 검사에 실패했습니다.',
        errors: flattenedErrors.fieldErrors,
        issues: formatZodIssues(parsedOrders.error.issues),
      });
    }

    const url = `${this.apiBaseUrl}/pay-order/seller/product-orders/dispatch`;
    const response = await firstValueFrom(
      this.http.post<NaverClaimProcessResponse>(
        url,
        { dispatchProductOrders: parsedOrders.data },
        { headers: { Authorization: `Bearer ${token}` } },
      ),
    );
    return response.data;
  }
  /**
   * 특정 상품 주문을 발송 지연 처리합니다.
   * @param productOrderId 상품 주문 번호
   * @param body 발송 지연 사유 정보
   * @returns API 응답 데이터
   */
  async delayDispatch(productOrderId: string, body: DelayDispatchBody): Promise<NaverClaimProcessResponse> {
    const token = await this.authService.getAccessToken(); // 🔑 인증 서비스 사용

    // 🎯 Zod 검증 추가
    const parsedBody = DelayDispatchBodySchema.safeParse(body);
    if (!parsedBody.success) {
      const flattenedErrors = parsedBody.error.flatten();
      this.logger.error('❌ 발송 지연 요청 파라미터 검증 실패:', flattenedErrors);
      throw new BadRequestException({
        message: '발송 지연 요청 입력값 유효성 검사에 실패했습니다.',
        errors: flattenedErrors.fieldErrors,
        issues: formatZodIssues(parsedBody.error.issues),
      });
    }

    const url = `${this.apiBaseUrl}/pay-order/seller/product-orders/${productOrderId}/delay`;
    const response = await firstValueFrom(
      this.http.post<NaverClaimProcessResponse>(url, parsedBody.data, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    return response.data;
  }
  /**
   * 배송 희망일 정보를 변경 처리합니다.
   * @param productOrderId 상품 주문 번호
   * @param body 배송 희망일 변경 정보
   * @returns API 응답 데이터
   */
  async changeHopeDelivery(productOrderId: string, body: ChangeHopeDeliveryBody): Promise<NaverClaimProcessResponse> {
    const token = await this.authService.getAccessToken(); // 🔑 인증 서비스 사용

    // 🎯 Zod 검증 추가
    const parsedBody = ChangeHopeDeliveryBodySchema.safeParse(body);
    if (!parsedBody.success) {
      const flattenedErrors = parsedBody.error.flatten();
      this.logger.error('❌ 배송 희망일 변경 요청 파라미터 검증 실패:', flattenedErrors);
      throw new BadRequestException({
        message: '배송 희망일 변경 요청 입력값 유효성 검사에 실패했습니다.',
        errors: flattenedErrors.fieldErrors,
        issues: formatZodIssues(parsedBody.error.issues),
      });
    }

    const url = `${this.apiBaseUrl}/pay-order/seller/product-orders/${productOrderId}/hope-delivery/change`;
    const response = await firstValueFrom(
      this.http.post<NaverClaimProcessResponse>(url, parsedBody.data, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    return response.data;
  }

  // =================================================================
  // == 주문 조회 (Order Lookup)
  // =================================================================

  /**
   * 지정된 기간 내에 변경된 상품 주문 내역을 조회합니다.
   * @param lastChangedFrom 조회 시작 시각 (ISO 8601 형식)
   * @returns API 응답 데이터
   */
  async getLastChangedStatuses(lastChangedFrom: string): Promise<NaverLastChangedStatusResponse> {
    const token = await this.authService.getAccessToken(); // 🔑 인증 서비스 사용
    const url = `${this.apiBaseUrl}/pay-order/seller/product-orders/last-changed-statuses`;
    const response = await firstValueFrom(
      this.http.get<NaverLastChangedStatusResponse>(url, {
        headers: { Authorization: `Bearer ${token}` },
        params: { lastChangedFrom, limitCount: 300 },
      }),
    );
    return response.data;
  }
  /**
   * 상품 주문 번호 목록으로 상세 주문 내역을 조회합니다.
   * @param productOrderIds 조회할 상품 주문 번호 배열
   * @returns API 응답 데이터
   */
  async getOrderDetails(productOrderIds: string[]): Promise<NaverProductOrderDetailsResponse> {
    const token = await this.authService.getAccessToken(); // 🔑 인증 서비스 사용
    const url = `${this.apiBaseUrl}/pay-order/seller/product-orders/query`;
    const response = await firstValueFrom(
      this.http.post<NaverProductOrderDetailsResponse>(
        url,
        { productOrderIds },
        { headers: { Authorization: `Bearer ${token}` } },
      ),
    );
    return response.data;
  }
  /**
   * 조건에 맞는 상품 주문에 대한 상세 내역을 조회합니다.
   * @param params 조회 조건을 담은 객체
   * @returns API 응답 데이터
   */
  async queryProductOrders(params: QueryProductOrdersParams): Promise<NaverProductOrderDetailsResponse> {
    const token = await this.authService.getAccessToken(); // 🔑 인증 서비스 사용

    // TODO: QueryProductOrdersParamsSchema Zod 검증은 원본 파일에 없었으나, 추가 고려
    // 원본 파일의 Zod import 목록에 QueryProductOrdersParamsSchema가 있었으므로,
    // 원본 작성자도 검증을 의도했을 수 있습니다.
    // 여기서는 일단 원본 로직을 그대로 따라 검증 없이 진행합니다.

    const url = `${this.apiBaseUrl}/pay-order/seller/product-orders`;
    const response = await firstValueFrom(
      this.http.get<NaverProductOrderDetailsResponse>(url, {
        headers: { Authorization: `Bearer ${token}` },
        params: params,
      }),
    );
    return response.data;
  }

  /**
   * 주문 번호(orderId)에 속한 모든 상품 주문 번호(productOrderId) 목록을 조회합니다.
   * @param orderId 조회할 주문 번호
   * @returns API 응답 데이터
   */
  async getProductOrderIdsByOrderId(orderId: string): Promise<NaverProductOrderIdsResponse> {
    const token = await this.authService.getAccessToken(); // 🔑 인증 서비스 사용
    const url = `${this.apiBaseUrl}/pay-order/seller/orders/${orderId}/product-order-ids`;
    const response = await firstValueFrom(
      this.http.get<NaverProductOrderIdsResponse>(url, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    return response.data;
  }
}
