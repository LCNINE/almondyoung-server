import { Injectable, BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { CoupangBaseClient } from './coupang-base.client.service';
import {
  GetExchangeRequestsParams,
  GetExchangeRequestsParamsSchema,
  GetExchangeRequestsResponse,
  CoupangConfirmExchangeReceiptRequest,
  CoupangConfirmExchangeReceiptRequestSchema,
  CoupangConfirmExchangeReceiptResponse,
  CoupangRejectExchangeRequest,
  CoupangRejectExchangeRequestSchema,
  CoupangRejectExchangeResponse,
  CoupangUploadExchangeInvoiceRequest,
  CoupangUploadExchangeInvoiceRequestSchema,
  CoupangUploadExchangeInvoiceResponse,
} from '../../../zods/coupang';
import { formatZodIssues } from '../../../shared/utils';

/**
 * 쿠팡 교환 클라이언트
 *
 * 교환 요청 조회, 교환 처리, 송장 업로드 등 교환 도메인 API를 담당합니다.
 *
 * @author Channel Adapter Team
 * @version 2.0.0
 */
@Injectable()
export class CoupangExchangeClient extends CoupangBaseClient {
  constructor(http: HttpService) {
    super(http);
  }

  /**
   * 기간별로 접수된 교환 요청 목록을 조회합니다.
   * @param params 조회 기간 및 필터 정보
   * @returns API 응답 데이터
   */
  async getExchangeRequests(
    params: GetExchangeRequestsParams,
  ): Promise<GetExchangeRequestsResponse> {
    const parsedParams = GetExchangeRequestsParamsSchema.safeParse(params);
    if (!parsedParams.success) {
      const flattenedErrors = parsedParams.error.flatten();
      this.logger.error(
        '❌ 교환요청 목록 조회 파라미터 검증 실패:',
        flattenedErrors,
      );
      throw new BadRequestException({
        message: '교환요청 목록 조회 입력값 유효성 검사에 실패했습니다.',
        errors: flattenedErrors.fieldErrors,
        issues: formatZodIssues(parsedParams.error.issues),
      });
    }

    const config = this.getApiConfig();
    try {
      // 쿼리 파라미터 구성 (값이 있는 것만 추가)
      const queryParams: Record<string, string> = {
        createdAtFrom: parsedParams.data.createdAtFrom,
        createdAtTo: parsedParams.data.createdAtTo,
      };
      if (parsedParams.data.status)
        queryParams.status = parsedParams.data.status;
      if (parsedParams.data.orderId)
        queryParams.orderId = String(parsedParams.data.orderId);
      if (parsedParams.data.nextToken)
        queryParams.nextToken = parsedParams.data.nextToken;
      if (parsedParams.data.maxPerPage)
        queryParams.maxPerPage = String(parsedParams.data.maxPerPage);

      const query = new URLSearchParams(queryParams).toString();
      this.logger.log(`🔍 쿠팡 교환요청 목록 조회 요청: ${query}`);

      const path = `/v2/providers/openapi/apis/api/v4/vendors/${config.vendorId}/exchangeRequests`;
      const authorization = this.generateAuthHeader(
        config.accessKey,
        config.secretKey,
        'GET',
        path,
        query,
      );
      const url = `${config.apiEndpoint}${path}?${query}`;

      const response = await firstValueFrom(
        this.http.get<GetExchangeRequestsResponse>(url, {
          headers: {
            Authorization: authorization,
            'Content-Type': 'application/json',
          },
        }),
      );

      this.logger.log(
        `👍 교환요청 목록 조회 성공: ${response.data.data.length}건`,
      );
      return response.data;
    } catch (error) {
      if (error.response) {
        this.logger.error(
          `❌ 쿠팡 교환요청 목록 조회 실패: ${error.response.status} - ${error.response.data?.error?.message || error.message}`,
        );
      } else {
        this.logger.error(`❌ 쿠팡 교환요청 목록 조회 실패: ${error.message}`);
      }
      throw new Error(`쿠팡 교환요청 목록 조회 실패: ${error.message}`);
    }
  }

  /**
   * 교환 요청 상품의 입고 확인 처리를 합니다.
   * @param payload 입고 확인할 exchangeId와 vendorId
   * @returns API 응답 데이터
   */
  async confirmExchangeReceipt(
    payload: CoupangConfirmExchangeReceiptRequest,
  ): Promise<CoupangConfirmExchangeReceiptResponse> {
    const parsedReq =
      CoupangConfirmExchangeReceiptRequestSchema.safeParse(payload);
    if (!parsedReq.success) {
      const flattenedErrors = parsedReq.error.flatten();
      this.logger.error(
        '❌ 교환상품 입고확인 파라미터 검증 실패:',
        flattenedErrors,
      );
      throw new BadRequestException({
        message: '교환상품 입고확인 입력값 유효성 검사에 실패했습니다.',
        errors: flattenedErrors.fieldErrors,
        issues: formatZodIssues(parsedReq.error.issues),
      });
    }

    const config = this.getApiConfig();
    const { exchangeId } = parsedReq.data;
    try {
      this.logger.log(`🚚 쿠팡 교환상품 입고확인 처리 요청: ${exchangeId}`);

      const path = `/v2/providers/openapi/apis/api/v4/vendors/${config.vendorId}/exchangeRequests/${exchangeId}/receiveConfirmation`;
      const authorization = this.generateAuthHeader(
        config.accessKey,
        config.secretKey,
        'PATCH',
        path,
      );
      const url = `${config.apiEndpoint}${path}`;

      const response = await firstValueFrom(
        this.http.patch<CoupangConfirmExchangeReceiptResponse>(
          url,
          parsedReq.data,
          {
            headers: {
              Authorization: authorization,
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      this.logger.log(
        `👍 교환상품 입고확인 처리 성공: ${exchangeId} - ${response.data.message}`,
      );
      return response.data;
    } catch (error) {
      if (error.response) {
        this.logger.error(
          `❌ 쿠팡 교환상품 입고확인 처리 실패: ${error.response.status} - ${error.response.data?.error?.message || error.message}`,
        );
      } else {
        this.logger.error(
          `❌ 쿠팡 교환상품 입고확인 처리 실패: ${error.message}`,
        );
      }
      throw new Error(`쿠팡 교환상품 입고확인 처리 실패: ${error.message}`);
    }
  }

  /**
   * 고객의 교환 요청을 거부 처리합니다.
   * @param payload 거부할 exchangeId와 거부 코드
   * @returns API 응답 데이터
   */
  async rejectExchangeRequest(
    payload: CoupangRejectExchangeRequest,
  ): Promise<CoupangRejectExchangeResponse> {
    const parsedReq = CoupangRejectExchangeRequestSchema.safeParse(payload);
    if (!parsedReq.success) {
      const flattenedErrors = parsedReq.error.flatten();
      this.logger.error(
        '❌ 교환요청 거부 파라미터 검증 실패:',
        flattenedErrors,
      );
      throw new BadRequestException({
        message: '교환요청 거부 입력값 유효성 검사에 실패했습니다.',
        errors: flattenedErrors.fieldErrors,
        issues: formatZodIssues(parsedReq.error.issues),
      });
    }

    const config = this.getApiConfig();
    const { exchangeId } = parsedReq.data;
    try {
      this.logger.log(`🚫 쿠팡 교환요청 거부 처리 요청: ${exchangeId}`);

      const path = `/v2/providers/openapi/apis/api/v4/vendors/${config.vendorId}/exchangeRequests/${exchangeId}/rejection`;
      const authorization = this.generateAuthHeader(
        config.accessKey,
        config.secretKey,
        'PATCH',
        path,
      );
      const url = `${config.apiEndpoint}${path}`;

      const response = await firstValueFrom(
        this.http.patch<CoupangRejectExchangeResponse>(url, parsedReq.data, {
          headers: {
            Authorization: authorization,
            'Content-Type': 'application/json',
          },
        }),
      );

      this.logger.log(
        `👍 교환요청 거부 처리 완료: ${exchangeId} - ${response.data.data.resultMessage}`,
      );
      return response.data;
    } catch (error) {
      if (error.response) {
        this.logger.error(
          `❌ 쿠팡 교환요청 거부 처리 실패: ${error.response.status} - ${error.response.data?.error?.message || error.message}`,
        );
      } else {
        this.logger.error(`❌ 쿠팡 교환요청 거부 처리 실패: ${error.message}`);
      }
      throw new Error(`쿠팡 교환요청 거부 처리 실패: ${error.message}`);
    }
  }

  /**
   * 교환 상품의 재배송 운송장을 업로드합니다.
   * @param exchangeId 교환 접수 번호 (URL Path에 사용)
   * @param payload 송장 정보 배열
   * @returns API 응답 데이터
   */
  async uploadExchangeInvoice(
    exchangeId: number | string,
    payload: CoupangUploadExchangeInvoiceRequest,
  ): Promise<CoupangUploadExchangeInvoiceResponse> {
    const parsedReq =
      CoupangUploadExchangeInvoiceRequestSchema.safeParse(payload);
    if (!parsedReq.success) {
      const flattenedErrors = parsedReq.error.flatten();
      this.logger.error(
        '❌ 교환상품 송장업로드 파라미터 검증 실패:',
        flattenedErrors,
      );
      throw new BadRequestException({
        message: '교환상품 송장업로드 입력값 유효성 검사에 실패했습니다.',
        errors: flattenedErrors.fieldErrors,
        issues: formatZodIssues(parsedReq.error.issues),
      });
    }

    const config = this.getApiConfig();
    try {
      this.logger.log(`🚀 쿠팡 교환상품 송장업로드 처리 요청: ${exchangeId}`);

      const path = `/v2/providers/openapi/apis/api/v4/vendors/${config.vendorId}/exchangeRequests/${exchangeId}/invoices`;
      const authorization = this.generateAuthHeader(
        config.accessKey,
        config.secretKey,
        'POST',
        path,
      );
      const url = `${config.apiEndpoint}${path}`;

      const response = await firstValueFrom(
        this.http.post<CoupangUploadExchangeInvoiceResponse>(
          url,
          parsedReq.data,
          {
            headers: {
              Authorization: authorization,
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      this.logger.log(
        `👍 교환상품 송장업로드 처리 완료: ${exchangeId} - ${response.data.data.resultMessage}`,
      );
      return response.data;
    } catch (error) {
      if (error.response) {
        this.logger.error(
          `❌ 쿠팡 교환상품 송장업로드 처리 실패: ${error.response.status} - ${error.response.data?.error?.message || error.message}`,
        );
      } else {
        this.logger.error(
          `❌ 쿠팡 교환상품 송장업로드 처리 실패: ${error.message}`,
        );
      }
      throw new Error(`쿠팡 교환상품 송장업로드 처리 실패: ${error.message}`);
    }
  }
}
