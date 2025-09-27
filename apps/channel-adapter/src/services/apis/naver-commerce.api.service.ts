import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as bcrypt from 'bcrypt';
import { z } from 'zod';
import {
  ChangeSaleStatusBody,
  ChangeHopeDeliveryBody,
  DelayDispatchBody,
  DispatchProductOrder,
  ExchangeRedeliveryBody,
  HoldExchangeBody,
  HoldReturnBody,
  NaverLastChangedStatusResponse,
  NaverProductOrderDetailsResponse,
  NaverProductOrderIdsResponse,
  QueryProductOrdersParams,
  RejectExchangeBody,
  RejectReturnBody,
  RequestCancelBody,
  RequestReturnBody,
  UpdateOptionStockBody,
  // 🎯 Zod 스키마들 import
  ExchangeRedeliveryBodySchema,
  HoldExchangeBodySchema,
  RejectExchangeBodySchema,
  HoldReturnBodySchema,
  RejectReturnBodySchema,
  RequestReturnBodySchema,
  RequestCancelBodySchema,
  DelayDispatchBodySchema,
  ChangeHopeDeliveryBodySchema,
  DispatchProductOrderSchema,
  QueryProductOrdersParamsSchema,
  ChangeSaleStatusBodySchema,
  UpdateOptionStockBodySchema,
} from '../../zods/naver-api.zod';
import { formatZodIssues } from '../../shared/utils';
// =================================================================
// == 1. 타입 정의 (Type Definitions)
// =================================================================

// -----------------------------------------------------------------
// -- 공통 타입 (Common Types)
// -----------------------------------------------------------------

/** 다수 API에서 공통으로 사용하는 실패 정보 구조체 */
interface FailProductOrderInfo {
  productOrderId: string;
  code: string;
  message: string;
}

/** 주문-클레임 처리 API의 공통 응답 데이터 구조체 */
interface ClaimProcessResponseData {
  successProductOrderIds: string[];
  failProductOrderInfos: FailProductOrderInfo[];
}

/** 주문-클레임 처리 API의 공통 응답 래퍼 구조체 */
export interface NaverClaimProcessResponse {
  timestamp: string;
  traceId: string;
  data: ClaimProcessResponseData;
}

/** OAuth 토큰 발급 API 응답 타입 */
interface NaverTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

// Zod 스키마로부터 TypeScript 타입 자동 생성;

// =================================================================
// == 2. API 클라이언트 서비스 (NaverCommerceApiService Class)
// =================================================================
@Injectable()
export class NaverCommerceApiService {
  private readonly logger = new Logger(NaverCommerceApiService.name);
  private readonly apiBaseUrl = this.getApiBaseUrl();

  constructor(private readonly http: HttpService) {}

  /**
   * API Base URL을 환경에 따라 결정합니다
   */
  private getApiBaseUrl(): string {
    // Mock 서버 사용 시
    if (process.env.NAVER_USE_MOCK_SERVER === 'true') {
      const mockUrl =
        process.env.ADAPTER_MOCK_BASE_URL || 'http://localhost:3001';
      this.logger.log(`🔧 네이버 Mock 서버 사용: ${mockUrl}`);
      return `${mockUrl}/naver`;
    }

    // 실제 네이버 API 사용
    return process.env.NAVER_API_ENDPOINT || '';
  }

  // == 교환 (Exchange)
  // =================================================================

  /**
   * 1건의 상품 주문에 대한 교환을 수거 완료 처리합니다.
   * @param token 액세스 토큰
   * @param productOrderId 상품 주문 번호
   * @returns API 응답 데이터
   */

  async approveExchangeCollection(
    token: string,
    productOrderId: string,
  ): Promise<NaverClaimProcessResponse> {
    const url = `${this.apiBaseUrl}/pay-order/seller/product-orders/${productOrderId}/claim/exchange/collect/approve`;
    const response = await firstValueFrom(
      this.http.post<NaverClaimProcessResponse>(
        url,
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      ),
    );
    return response.data;
  }

  /**
   * 1건의 상품 주문 교환 승인 건을 재배송 처리합니다.
   * @param token 액세스 토큰
   * @param productOrderId 상품 주문 번호
   * @param body 재배송 정보
   * @returns API 응답 데이터
   */

  async dispatchExchangeRedelivery(
    token: string,
    productOrderId: string,
    body: ExchangeRedeliveryBody,
  ): Promise<NaverClaimProcessResponse> {
    // 🎯 Zod 검증 추가
    const parsedBody = ExchangeRedeliveryBodySchema.safeParse(body);
    if (!parsedBody.success) {
      const flattenedErrors = parsedBody.error.flatten();
      this.logger.error(
        '❌ 교환 재배송 요청 파라미터 검증 실패:',
        flattenedErrors,
      );
      throw new BadRequestException({
        message: '교환 재배송 요청 입력값 유효성 검사에 실패했습니다.',
        errors: flattenedErrors.fieldErrors,
        issues: formatZodIssues(parsedBody.error.issues),
      });
    }

    const url = `${this.apiBaseUrl}/pay-order/seller/product-orders/${productOrderId}/claim/exchange/dispatch`;
    const response = await firstValueFrom(
      this.http.post<NaverClaimProcessResponse>(url, parsedBody.data, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    return response.data;
  }

  /**
   * 1건의 상품 주문에 대한 교환을 보류합니다.
   * @param token 액세스 토큰
   * @param productOrderId 상품 주문 번호
   * @param body 교환 보류 사유 정보
   * @returns API 응답 데이터
   */

  async holdExchange(
    token: string,
    productOrderId: string,
    body: HoldExchangeBody,
  ): Promise<NaverClaimProcessResponse> {
    // 🎯 Zod 검증 추가
    const parsedBody = HoldExchangeBodySchema.safeParse(body);
    if (!parsedBody.success) {
      const flattenedErrors = parsedBody.error.flatten();
      this.logger.error(
        '❌ 교환 보류 요청 파라미터 검증 실패:',
        flattenedErrors,
      );
      throw new BadRequestException({
        message: '교환 보류 요청 입력값 유효성 검사에 실패했습니다.',
        errors: flattenedErrors.fieldErrors,
        issues: formatZodIssues(parsedBody.error.issues),
      });
    }

    const url = `${this.apiBaseUrl}/pay-order/seller/product-orders/${productOrderId}/claim/exchange/holdback`;
    const response = await firstValueFrom(
      this.http.post<NaverClaimProcessResponse>(url, parsedBody.data, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    return response.data;
  }
  /**
   * 1건의 상품 주문에 대한 교환 보류를 해제합니다.
   * @param token 액세스 토큰
   * @param productOrderId 상품 주문 번호
   * @returns API 응답 데이터
   */
  async releaseExchangeHold(
    token: string,
    productOrderId: string,
  ): Promise<NaverClaimProcessResponse> {
    const url = `${this.apiBaseUrl}/pay-order/seller/product-orders/${productOrderId}/claim/exchange/holdback/release`;
    const response = await firstValueFrom(
      this.http.post<NaverClaimProcessResponse>(
        url,
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      ),
    );
    return response.data;
  }
  /**
   * 1건의 상품 주문에 대한 교환 요청을 거부(철회)합니다.
   * @param token 액세스 토큰
   * @param productOrderId 상품 주문 번호
   * @param body 교환 거부 사유
   * @returns API 응답 데이터
   */
  async rejectExchange(
    token: string,
    productOrderId: string,
    body: RejectExchangeBody,
  ): Promise<NaverClaimProcessResponse> {
    // 🎯 Zod 검증 추가
    const parsedBody = RejectExchangeBodySchema.safeParse(body);
    if (!parsedBody.success) {
      const flattenedErrors = parsedBody.error.flatten();
      this.logger.error(
        '❌ 교환 거부 요청 파라미터 검증 실패:',
        flattenedErrors,
      );
      throw new BadRequestException({
        message: '교환 거부 요청 입력값 유효성 검사에 실패했습니다.',
        errors: flattenedErrors.fieldErrors,
        issues: formatZodIssues(parsedBody.error.issues),
      });
    }

    const url = `${this.apiBaseUrl}/pay-order/seller/product-orders/${productOrderId}/claim/exchange/reject`;
    const response = await firstValueFrom(
      this.http.post<NaverClaimProcessResponse>(url, parsedBody.data, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    return response.data;
  }

  // =================================================================
  // == 반품 (Return)
  // =================================================================
  /**
   * 1건의 상품 주문에 대한 반품 요청을 승인합니다.
   * @param token 액세스 토큰
   * @param productOrderId 상품 주문 번호
   * @returns API 응답 데이터
   */

  async approveReturn(
    token: string,
    productOrderId: string,
  ): Promise<NaverClaimProcessResponse> {
    const url = `${this.apiBaseUrl}/pay-order/seller/product-orders/${productOrderId}/claim/return/approve`;
    const response = await firstValueFrom(
      this.http.post<NaverClaimProcessResponse>(
        url,
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      ),
    );
    return response.data;
  }

  /**
   * 1건의 상품 주문에 대한 반품을 보류합니다.
   * @param token 액세스 토큰
   * @param productOrderId 상품 주문 번호
   * @param body 반품 보류 사유 정보
   * @returns API 응답 데이터
   */
  async holdReturn(
    token: string,
    productOrderId: string,
    body: HoldReturnBody,
  ): Promise<NaverClaimProcessResponse> {
    // 🎯 Zod 검증 추가
    const parsedBody = HoldReturnBodySchema.safeParse(body);
    if (!parsedBody.success) {
      const flattenedErrors = parsedBody.error.flatten();
      this.logger.error(
        '❌ 반품 보류 요청 파라미터 검증 실패:',
        flattenedErrors,
      );
      throw new BadRequestException({
        message: '반품 보류 요청 입력값 유효성 검사에 실패했습니다.',
        errors: flattenedErrors.fieldErrors,
        issues: formatZodIssues(parsedBody.error.issues),
      });
    }

    const url = `${this.apiBaseUrl}/pay-order/seller/product-orders/${productOrderId}/claim/return/holdback`;
    const response = await firstValueFrom(
      this.http.post<NaverClaimProcessResponse>(url, parsedBody.data, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    return response.data;
  }
  /**
   * 1건의 상품 주문에 대한 반품 보류를 해제합니다.
   * @param token 액세스 토큰
   * @param productOrderId 상품 주문 번호
   * @returns API 응답 데이터
   */
  async releaseReturnHold(
    token: string,
    productOrderId: string,
  ): Promise<NaverClaimProcessResponse> {
    const url = `${this.apiBaseUrl}/pay-order/seller/product-orders/${productOrderId}/claim/return/holdback/release`;
    const response = await firstValueFrom(
      this.http.post<NaverClaimProcessResponse>(
        url,
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      ),
    );
    return response.data;
  }
  /**
   * 1건의 상품 주문에 대한 반품 요청을 거부(철회)합니다.
   * @param token 액세스 토큰
   * @param productOrderId 상품 주문 번호
   * @param body 반품 거부 사유
   * @returns API 응답 데이터
   */
  async rejectReturn(
    token: string,
    productOrderId: string,
    body: RejectReturnBody,
  ): Promise<NaverClaimProcessResponse> {
    // 🎯 Zod 검증 추가
    const parsedBody = RejectReturnBodySchema.safeParse(body);
    if (!parsedBody.success) {
      const flattenedErrors = parsedBody.error.flatten();
      this.logger.error(
        '❌ 반품 거부 요청 파라미터 검증 실패:',
        flattenedErrors,
      );
      throw new BadRequestException({
        message: '반품 거부 요청 입력값 유효성 검사에 실패했습니다.',
        errors: flattenedErrors.fieldErrors,
        issues: formatZodIssues(parsedBody.error.issues),
      });
    }

    const url = `${this.apiBaseUrl}/pay-order/seller/product-orders/${productOrderId}/claim/return/reject`;
    const response = await firstValueFrom(
      this.http.post<NaverClaimProcessResponse>(url, parsedBody.data, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    return response.data;
  }

  /**
   * 1건의 상품 주문에 대해 반품 요청합니다.
   * @param token 액세스 토큰
   * @param productOrderId 상품 주문 번호
   * @param body 반품 요청 정보
   * @returns API 응답 데이터
   */
  async requestReturn(
    token: string,
    productOrderId: string,
    body: RequestReturnBody,
  ): Promise<NaverClaimProcessResponse> {
    // 🎯 Zod 검증 추가
    const parsedBody = RequestReturnBodySchema.safeParse(body);
    if (!parsedBody.success) {
      const flattenedErrors = parsedBody.error.flatten();
      this.logger.error('❌ 반품 요청 파라미터 검증 실패:', flattenedErrors);
      throw new BadRequestException({
        message: '반품 요청 입력값 유효성 검사에 실패했습니다.',
        errors: flattenedErrors.fieldErrors,
        issues: formatZodIssues(parsedBody.error.issues),
      });
    }

    const url = `${this.apiBaseUrl}/pay-order/seller/product-orders/${productOrderId}/claim/return/request`;
    const response = await firstValueFrom(
      this.http.post<NaverClaimProcessResponse>(url, parsedBody.data, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    return response.data;
  }

  // =================================================================
  // == 발주 / 발송 처리 (Order / Dispatch)
  // =================================================================

  /**
   * 단수 또는 복수 개 상품 주문의 발주를 확인 처리합니다.
   * @param token 액세스 토큰
   * @param productOrderIds 발주 확인할 상품 주문 번호 배열
   * @returns API 응답 데이터
   */
  async confirmOrders(
    token: string,
    productOrderIds: string[],
  ): Promise<NaverClaimProcessResponse> {
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
   * @param token 액세스 토큰
   * @param dispatchProductOrders 발송 처리할 주문 정보 배열
   * @returns API 응답 데이터
   */
  async dispatchOrders(
    token: string,
    dispatchProductOrders: DispatchProductOrder[],
  ): Promise<NaverClaimProcessResponse> {
    // 🎯 Zod 검증 추가 (배열 요소별 검증)
    const parsedOrders = z
      .array(DispatchProductOrderSchema)
      .safeParse(dispatchProductOrders);
    if (!parsedOrders.success) {
      const flattenedErrors = parsedOrders.error.flatten();
      this.logger.error(
        '❌ 발송 처리 요청 파라미터 검증 실패:',
        flattenedErrors,
      );
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
   * @param token 액세스 토큰
   * @param productOrderId 상품 주문 번호
   * @param body 발송 지연 사유 정보
   * @returns API 응답 데이터
   */
  async delayDispatch(
    token: string,
    productOrderId: string,
    body: DelayDispatchBody,
  ): Promise<NaverClaimProcessResponse> {
    // 🎯 Zod 검증 추가
    const parsedBody = DelayDispatchBodySchema.safeParse(body);
    if (!parsedBody.success) {
      const flattenedErrors = parsedBody.error.flatten();
      this.logger.error(
        '❌ 발송 지연 요청 파라미터 검증 실패:',
        flattenedErrors,
      );
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
   * @param token 액세스 토큰
   * @param productOrderId 상품 주문 번호
   * @param body 배송 희망일 변경 정보
   * @returns API 응답 데이터
   */
  async changeHopeDelivery(
    token: string,
    productOrderId: string,
    body: ChangeHopeDeliveryBody,
  ): Promise<NaverClaimProcessResponse> {
    // 🎯 Zod 검증 추가
    const parsedBody = ChangeHopeDeliveryBodySchema.safeParse(body);
    if (!parsedBody.success) {
      const flattenedErrors = parsedBody.error.flatten();
      this.logger.error(
        '❌ 배송 희망일 변경 요청 파라미터 검증 실패:',
        flattenedErrors,
      );
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
   * @param token 액세스 토큰
   * @param lastChangedFrom 조회 시작 시각 (ISO 8601 형식)
   * @returns API 응답 데이터
   */
  async getLastChangedStatuses(
    token: string,
    lastChangedFrom: string,
  ): Promise<NaverLastChangedStatusResponse> {
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
   * @param token 액세스 토큰
   * @param productOrderIds 조회할 상품 주문 번호 배열
   * @returns API 응답 데이터
   */
  async getOrderDetails(
    token: string,
    productOrderIds: string[],
  ): Promise<NaverProductOrderDetailsResponse> {
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
   * @param token 액세스 토큰
   * @param params 조회 조건을 담은 객체
   * @returns API 응답 데이터
   */
  async queryProductOrders(
    token: string,
    params: QueryProductOrdersParams,
  ): Promise<NaverProductOrderDetailsResponse> {
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
   * @param token 액세스 토큰
   * @param orderId 조회할 주문 번호
   * @returns API 응답 데이터
   */
  async getProductOrderIdsByOrderId(
    token: string,
    orderId: string,
  ): Promise<NaverProductOrderIdsResponse> {
    const url = `${this.apiBaseUrl}/pay-order/seller/orders/${orderId}/product-order-ids`;
    const response = await firstValueFrom(
      this.http.get<NaverProductOrderIdsResponse>(url, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    return response.data;
  }

  // =================================================================
  // == 취소 (Cancel)
  // =================================================================
  /**
   * 1건의 상품 주문에 대한 취소 요청을 승인합니다.
   * @param token 액세스 토큰
   * @param productOrderId 상품 주문 번호
   * @returns API 응답 데이터
   */
  async approveCancel(
    token: string,
    productOrderId: string,
  ): Promise<NaverClaimProcessResponse> {
    const url = `${this.apiBaseUrl}/pay-order/seller/product-orders/${productOrderId}/claim/cancel/approve`;
    const response = await firstValueFrom(
      this.http.post<NaverClaimProcessResponse>(
        url,
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      ),
    );
    return response.data;
  }
  /**
   * 1건의 상품 주문을 취소 요청합니다.
   * @param token 액세스 토큰
   * @param productOrderId 상품 주문 번호
   * @param body 취소 요청 정보
   * @returns API 응답 데이터
   */
  async requestCancel(
    token: string,
    productOrderId: string,
    body: RequestCancelBody,
  ): Promise<NaverClaimProcessResponse> {
    // 🎯 Zod 검증 추가
    const parsedBody = RequestCancelBodySchema.safeParse(body);
    if (!parsedBody.success) {
      const flattenedErrors = parsedBody.error.flatten();
      this.logger.error('❌ 취소 요청 파라미터 검증 실패:', flattenedErrors);
      throw new BadRequestException({
        message: '취소 요청 입력값 유효성 검사에 실패했습니다.',
        errors: flattenedErrors.fieldErrors,
        issues: formatZodIssues(parsedBody.error.issues),
      });
    }

    const url = `${this.apiBaseUrl}/pay-order/seller/product-orders/${productOrderId}/claim/cancel/request`;
    const response = await firstValueFrom(
      this.http.post<NaverClaimProcessResponse>(url, parsedBody.data, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    return response.data;
  }
  /**
   * (단일 상품용) 판매 상태와 재고를 변경합니다.
   * @param token 액세스 토큰
   * @param originProductNo 원상품 번호
   * @param body 변경할 상태 및 재고 정보. 재고 업데이트 시 statusType: 'SALE' 필수
   * @returns API 응답 데이터
   */
  async changeSaleStatus(
    token: string,
    originProductNo: number,
    body: ChangeSaleStatusBody,
  ): Promise<any> {
    // 🎯 Zod 검증 추가
    const parsedBody = ChangeSaleStatusBodySchema.safeParse(body);
    if (!parsedBody.success) {
      const flattenedErrors = parsedBody.error.flatten();
      this.logger.error(
        '❌ 판매 상태 변경 요청 파라미터 검증 실패:',
        flattenedErrors,
      );
      throw new BadRequestException({
        message: '판매 상태 변경 요청 입력값 유효성 검사에 실패했습니다.',
        errors: flattenedErrors.fieldErrors,
        issues: formatZodIssues(parsedBody.error.issues),
      });
    }

    // TODO: 이 API의 실제 성공 응답 타입을 확인하고 any 대신 구체적인 타입 적용 필요
    const url = `${this.apiBaseUrl}/products/origin-products/${originProductNo}/change-status`;
    const response = await firstValueFrom(
      this.http.put(url, parsedBody.data, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    return response.data;
  }

  /**
   * (옵션 상품용) 옵션별 재고, 가격, 할인가를 변경합니다.
   * @param token 액세스 토큰
   * @param originProductNo 원상품 번호
   * @param body 변경할 옵션 정보
   * @returns API 응답 데이터
   */
  async updateOptionStock(
    token: string,
    originProductNo: number,
    body: UpdateOptionStockBody,
  ): Promise<any> {
    // 🎯 Zod 검증 추가
    const parsedBody = UpdateOptionStockBodySchema.safeParse(body);
    if (!parsedBody.success) {
      const flattenedErrors = parsedBody.error.flatten();
      this.logger.error(
        '❌ 옵션 재고 업데이트 요청 파라미터 검증 실패:',
        flattenedErrors,
      );
      throw new BadRequestException({
        message: '옵션 재고 업데이트 요청 입력값 유효성 검사에 실패했습니다.',
        errors: flattenedErrors.fieldErrors,
        issues: formatZodIssues(parsedBody.error.issues),
      });
    }

    // TODO: 이 API의 실제 성공 응답 타입을 확인하고 any 대신 구체적인 타입 적용 필요
    const url = `${this.apiBaseUrl}/products/origin-products/${originProductNo}/option-stock`;
    const response = await firstValueFrom(
      this.http.put(url, parsedBody.data, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    return response.data;
  }
  // =================================================================
  // == 인증 (Authentication)
  // =================================================================

  async getAccessToken(): Promise<string> {
    this.logger.log('네이버 커머스 API 액세스 토큰 발급 요청');
    const timestamp = Date.now().toString();
    const clientId = process.env.NAVER_CLIENT_ID ?? '';
    const clientSecret = process.env.NAVER_CLIENT_SECRET ?? '';

    // 네이버 API 전자서명 생성 방식
    // 1. password: client_id + "_" + timestamp
    const password = `${clientId}_${timestamp}`;

    // 2. client_secret은 bcrypt salt 형식이어야 함 (예: $2a$10$abcdefghijklmnopqrstuv)
    // Mock 환경에서는 유효한 bcrypt salt를 생성
    let salt = clientSecret;
    if (!salt.startsWith('$2a$') && !salt.startsWith('$2b$')) {
      // Mock 환경: 유효한 bcrypt salt 생성
      salt = bcrypt.genSaltSync(10);
      this.logger.debug(
        `Mock 환경: bcrypt salt 생성됨 ${salt.substring(0, 10)}...`,
      );
    }

    // 3. bcrypt 해싱
    const hashed = bcrypt.hashSync(password, salt);

    // 4. Base64 인코딩
    const clientSecretSign = Buffer.from(hashed, 'utf-8').toString('base64');
    const params = new URLSearchParams([
      ['grant_type', 'client_credentials'],
      ['client_id', clientId],
      ['timestamp', timestamp],
      ['client_secret_sign', clientSecretSign],
      ['type', 'SELF'],
    ]);
    const res = await firstValueFrom(
      this.http.post<NaverTokenResponse>(
        `${this.apiBaseUrl}/oauth2/token`,
        params,
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      ),
    );
    this.logger.log('✅ 액세스 토큰 발급 성공');
    return res.data.access_token;
  }
}
