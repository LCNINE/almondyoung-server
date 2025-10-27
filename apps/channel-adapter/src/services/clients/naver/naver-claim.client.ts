import { Injectable, BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { NaverBaseClient } from './naver-base.client';

// TODO: 추후 naver-api.types.ts 파일로 이동할 타입
import {
  ExchangeRedeliveryBody,
  HoldExchangeBody,
  HoldReturnBody,
  RejectExchangeBody,
  RejectReturnBody,
  RequestCancelBody,
  RequestReturnBody,
  // 🎯 Zod 스키마들 import
  ExchangeRedeliveryBodySchema,
  HoldExchangeBodySchema,
  RejectExchangeBodySchema,
  HoldReturnBodySchema,
  RejectReturnBodySchema,
  RequestReturnBodySchema,
  RequestCancelBodySchema,
} from '../../../zods/naver/naver.claim.zod';
import { formatZodIssues } from '../../../shared/utils';
import { NaverAuthService } from './naver-auth.client';

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
export class NaverClaimClient extends NaverBaseClient {
  constructor(
    protected readonly http: HttpService,
    private readonly authService: NaverAuthService,
  ) {
    // 부모 클래스(NaverBaseClient)의 생성자에 Logger 이름을 전달합니다.
    super(http, NaverClaimClient.name);
  }

  // =================================================================
  // == 교환 (Exchange)
  // =================================================================

  /**
   * 1건의 상품 주문에 대한 교환을 수거 완료 처리합니다.
   * @param productOrderId 상품 주문 번호
   * @returns API 응답 데이터
   */
  async approveExchangeCollection(
    productOrderId: string,
  ): Promise<NaverClaimProcessResponse> {
    const token = await this.authService.getAccessToken(); // 🔑 인증 서비스 사용
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
   * @param productOrderId 상품 주문 번호
   * @param body 재배송 정보
   * @returns API 응답 데이터
   */
  async dispatchExchangeRedelivery(
    productOrderId: string,
    body: ExchangeRedeliveryBody,
  ): Promise<NaverClaimProcessResponse> {
    const token = await this.authService.getAccessToken(); // 🔑 인증 서비스 사용

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
   * @param productOrderId 상품 주문 번호
   * @param body 교환 보류 사유 정보
   * @returns API 응답 데이터
   */
  async holdExchange(
    productOrderId: string,
    body: HoldExchangeBody,
  ): Promise<NaverClaimProcessResponse> {
    const token = await this.authService.getAccessToken(); // 🔑 인증 서비스 사용

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
   * @param productOrderId 상품 주문 번호
   * @returns API 응답 데이터
   */
  async releaseExchangeHold(
    productOrderId: string,
  ): Promise<NaverClaimProcessResponse> {
    const token = await this.authService.getAccessToken(); // 🔑 인증 서비스 사용
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
   * @param productOrderId 상품 주문 번호
   * @param body 교환 거부 사유
   * @returns API 응답 데이터
   */
  async rejectExchange(
    productOrderId: string,
    body: RejectExchangeBody,
  ): Promise<NaverClaimProcessResponse> {
    const token = await this.authService.getAccessToken(); // 🔑 인증 서비스 사용

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
   * @param productOrderId 상품 주문 번호
   * @returns API 응답 데이터
   */
  async approveReturn(
    productOrderId: string,
  ): Promise<NaverClaimProcessResponse> {
    const token = await this.authService.getAccessToken(); // 🔑 인증 서비스 사용
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
   * @param productOrderId 상품 주문 번호
   * @param body 반품 보류 사유 정보
   * @returns API 응답 데이터
   */
  async holdReturn(
    productOrderId: string,
    body: HoldReturnBody,
  ): Promise<NaverClaimProcessResponse> {
    const token = await this.authService.getAccessToken(); // 🔑 인증 서비스 사용

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
   * @param productOrderId 상품 주문 번호
   * @returns API 응답 데이터
   */
  async releaseReturnHold(
    productOrderId: string,
  ): Promise<NaverClaimProcessResponse> {
    const token = await this.authService.getAccessToken(); // 🔑 인증 서비스 사용
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
   * @param productOrderId 상품 주문 번호
   * @param body 반품 거부 사유
   * @returns API 응답 데이터
   */
  async rejectReturn(
    productOrderId: string,
    body: RejectReturnBody,
  ): Promise<NaverClaimProcessResponse> {
    const token = await this.authService.getAccessToken(); // 🔑 인증 서비스 사용

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
   * @param productOrderId 상품 주문 번호
   * @param body 반품 요청 정보
   * @returns API 응답 데이터
   */
  async requestReturn(
    productOrderId: string,
    body: RequestReturnBody,
  ): Promise<NaverClaimProcessResponse> {
    const token = await this.authService.getAccessToken(); // 🔑 인증 서비스 사용

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
  // == 취소 (Cancel)
  // =================================================================
  /**
   * 1건의 상품 주문에 대한 취소 요청을 승인합니다.
   * @param productOrderId 상품 주문 번호
   * @returns API 응답 데이터
   */
  async approveCancel(
    productOrderId: string,
  ): Promise<NaverClaimProcessResponse> {
    const token = await this.authService.getAccessToken(); // 🔑 인증 서비스 사용
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
   * @param productOrderId 상품 주문 번호
   * @param body 취소 요청 정보
   * @returns API 응답 데이터
   */
  async requestCancel(
    productOrderId: string,
    body: RequestCancelBody,
  ): Promise<NaverClaimProcessResponse> {
    const token = await this.authService.getAccessToken(); // 🔑 인증 서비스 사용

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
}
