import { Injectable, BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { CoupangBaseClient } from './coupang-base.client.service';
import {
  CoupangAcknowledgeOrdersheetsRequest,
  CoupangAcknowledgeOrdersheetsRequestSchema,
  CoupangAcknowledgeOrdersheetsResponse,
  CoupangUpdateInvoiceRequest,
  CoupangUpdateInvoiceRequestSchema,
  CoupangUpdateInvoiceResponse,
  CoupangUploadInvoiceRequest,
  CoupangUploadInvoiceRequestSchema,
  CoupangUploadInvoiceResponse,
  CoupangDeliveryHistoryResponse,
  CoupangOrderSheet,
  CoupangOrderSheetByOrderIdResponse,
  CoupangOrderSheetListResponse,
  CoupangSingleOrderSheetResponse,
} from '../../../zods/coupang';
import { formatZodIssues } from '../../../shared/utils';

/**
 * 발주서 목록 조회 파라미터
 */
export interface GetOrderSheetsParams {
  createdAtFrom: string;
  createdAtTo: string;
  status: string;
  maxPerPage?: number;
  nextToken?: string;
}

/**
 * 쿠팡 주문/발주서 클라이언트
 *
 * 주문 조회, 송장 처리, 배송 히스토리 등 주문 도메인 API를 담당합니다.
 *
 * @author Channel Adapter Team
 * @version 2.0.0
 */
@Injectable()
export class CoupangOrderClient extends CoupangBaseClient {
  constructor(http: HttpService) {
    super(http);
  }

  // =================================================================
  // == 발주서 조회 (Order Sheet Lookup)
  // =================================================================

  /**
   * 발주서 목록을 조회합니다 (페이징 지원)
   * @param params 조회 파라미터
   * @returns API 응답 데이터
   */
  async getOrderSheets(
    params: GetOrderSheetsParams,
  ): Promise<CoupangOrderSheetListResponse> {
    try {
      const config = this.getApiConfig();

      // API 호출 파라미터 구성
      const queryParams = new URLSearchParams({
        createdAtFrom: params.createdAtFrom,
        createdAtTo: params.createdAtTo,
        status: params.status,
        maxPerPage: String(params.maxPerPage || 50),
      });

      if (params.nextToken) {
        queryParams.append('nextToken', params.nextToken);
      }

      const path = `/v2/providers/openapi/apis/api/v5/vendors/${config.vendorId}/ordersheets`;
      const queryString = queryParams.toString();

      // 쿠팡 API 인증 헤더 생성 (쿼리 파라미터 포함)
      const authorization = this.generateAuthHeader(
        config.accessKey,
        config.secretKey,
        'GET',
        path,
        queryString,
      );

      const url = `${config.apiEndpoint}${path}?${queryString}`;
      this.logger.log(`📡 쿠팡 발주서 목록 조회: ${url}`);

      const response = await firstValueFrom(
        this.http.get<CoupangOrderSheetListResponse>(url, {
          headers: {
            Authorization: authorization,
            'Content-Type': 'application/json',
          },
        }),
      );

      // 네이버 스타일: 간단한 응답 체크만 (과도한 Zod 검증 제거)
      if (response.data.code !== 200) {
        throw new Error(
          `쿠팡 API 오류: ${response.data.code} - ${response.data.message}`,
        );
      }

      this.logger.log(`✅ 발주서 목록 조회 성공: ${response.data || 0}건`);
      return response.data;
    } catch (error) {
      this.logger.error('❌ 쿠팡 발주서 목록 조회 실패:', error);
      throw new Error(`쿠팡 발주서 목록 조회 실패: ${error.message}`);
    }
  }

  /**
   * 발주서 단건을 조회합니다 (shipmentBoxId 기준)
   * @param shipmentBoxId 배송번호(묶음배송번호)
   * @returns API 응답 데이터
   */
  async getSingleOrderSheet(
    shipmentBoxId: string | number,
  ): Promise<CoupangSingleOrderSheetResponse> {
    try {
      const config = this.getApiConfig();

      this.logger.log(
        `🔍 쿠팡 발주서 단건 조회 (shipmentBoxId): ${shipmentBoxId}`,
      );

      const path = `/v2/providers/openapi/apis/api/v5/vendors/${config.vendorId}/ordersheets/${shipmentBoxId}`;
      const authorization = this.generateAuthHeader(
        config.accessKey,
        config.secretKey,
        'GET',
        path,
      );

      const url = `${config.apiEndpoint}${path}`;
      this.logger.log(`📡 쿠팡 단건 조회 API 호출: ${url}`);

      const response = await firstValueFrom(
        this.http.get<CoupangSingleOrderSheetResponse>(url, {
          headers: {
            Authorization: authorization,
            'Content-Type': 'application/json',
          },
        }),
      );

      // 네이버 스타일: 간단한 응답 체크만
      if (response.data.code !== 200) {
        throw new Error(
          `쿠팡 API 오류: ${response.data.code} - ${response.data.message}`,
        );
      }

      this.logger.log(`✅ 쿠팡 발주서 단건 조회 성공: ${shipmentBoxId}`);
      return response.data;
    } catch (error) {
      this.logger.error(
        `❌ 쿠팡 발주서 단건 조회 실패 (${shipmentBoxId}):`,
        error,
      );
      throw new Error(`쿠팡 발주서 단건 조회 실패: ${error.message}`);
    }
  }

  /**
   * 발주서 단건을 조회합니다 (orderId 기준)
   * @param orderId 주문번호
   * @returns API 응답 데이터
   */
  async getSingleOrderSheetByOrderId(
    orderId: string | number,
  ): Promise<CoupangOrderSheetByOrderIdResponse> {
    try {
      const config = this.getApiConfig();

      this.logger.log(`🔍 쿠팡 발주서 단건 조회 (orderId): ${orderId}`);

      const path = `/v2/providers/openapi/apis/api/v5/vendors/${config.vendorId}/${orderId}/ordersheets`;
      const authorization = this.generateAuthHeader(
        config.accessKey,
        config.secretKey,
        'GET',
        path,
      );

      const url = `${config.apiEndpoint}${path}`;
      this.logger.log(`📡 쿠팡 단건 조회 (orderId) API 호출: ${url}`);

      const response = await firstValueFrom(
        this.http.get<CoupangOrderSheetByOrderIdResponse>(url, {
          headers: {
            Authorization: authorization,
            'Content-Type': 'application/json',
          },
        }),
      );

      // 네이버 스타일: 간단한 응답 체크만
      if (response.data.code !== 200) {
        throw new Error(
          `쿠팡 API 오류: ${response.data.code} - ${response.data.message}`,
        );
      }

      this.logger.log(
        `✅ 쿠팡 발주서 단건 조회 (orderId) 성공: ${orderId} (${response.data || 0}건)`,
      );
      return response.data;
    } catch (error) {
      this.logger.error(
        `❌ 쿠팡 발주서 단건 조회 (orderId) 실패 (${orderId}):`,
        error,
      );
      throw new Error(`쿠팡 발주서 단건 조회 (orderId) 실패: ${error.message}`);
    }
  }

  /**
   * 특정 상태의 모든 발주서를 페이징을 통해 조회합니다
   * @param createdAtFrom 조회 시작 일시
   * @param createdAtTo 조회 종료 일시
   * @param status 발주서 상태
   * @returns 모든 발주서 배열
   */
  async getAllOrderSheetsByStatus(
    createdAtFrom: string,
    createdAtTo: string,
    status: string,
  ): Promise<CoupangOrderSheet[]> {
    const allOrderSheets: CoupangOrderSheet[] = [];
    let nextToken: string | undefined;

    do {
      try {
        const response = await this.getOrderSheets({
          createdAtFrom,
          createdAtTo,
          status,
          maxPerPage: 50,
          nextToken,
        });

        allOrderSheets.push(...response.data);
        nextToken = response.nextToken;

        this.logger.log(
          `📄 페이지 조회 완료: ${response.data.length}건 (누적: ${allOrderSheets.length}건)`,
        );

        // API 호출 제한 대응을 위한 지연
        if (nextToken) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      } catch (error) {
        this.logger.error(
          `❌ 발주서 페이징 조회 실패 (nextToken: ${nextToken}):`,
          error,
        );
        throw error;
      }
    } while (nextToken);

    this.logger.log(`🎯 전체 발주서 조회 완료: ${allOrderSheets.length}건`);
    return allOrderSheets;
  }

  async acknowledgeOrdersheets(
    payload: CoupangAcknowledgeOrdersheetsRequest,
  ): Promise<CoupangAcknowledgeOrdersheetsResponse> {
    // 요청 파라미터 검증
    const parsedReq =
      CoupangAcknowledgeOrdersheetsRequestSchema.safeParse(payload);
    if (!parsedReq.success) {
      const flattenedErrors = parsedReq.error.flatten();
      this.logger.error(
        '상품준비중 처리 요청 파라미터 검증 실패:',
        flattenedErrors,
      );
      throw new BadRequestException({
        message: '상품준비중 처리 입력값 유효성 검사에 실패했습니다.',
        errors: flattenedErrors.fieldErrors,
        issues: formatZodIssues(parsedReq.error.issues),
      });
    }

    const { vendorId, shipmentBoxIds } = parsedReq.data;
    const config = this.getApiConfig();

    this.logger.log(
      `📦 쿠팡 상품준비중 처리 요청 (vendorId=${vendorId}, count=${shipmentBoxIds.length})`,
    );

    const path = `/v2/providers/openapi/apis/api/v4/vendors/${config.vendorId}/ordersheets/acknowledgement`;
    const authorization = this.generateAuthHeader(
      config.accessKey,
      config.secretKey,
      'PATCH',
      path,
    );
    const url = `${config.apiEndpoint}${path}`;

    try {
      const response = await firstValueFrom(
        this.http.patch(url, parsedReq.data, {
          headers: {
            Authorization: authorization,
            'Content-Type': 'application/json',
          },
        }),
      );

      // 응답 검증
      const parsedRes = response.data;

      this.logger.log(
        `✅ 상품준비중 처리 성공 (전체 상태 코드=${parsedRes.data.responseCode})`,
      );
      return parsedRes.data;
    } catch (error) {
      this.logger.error('❌ 쿠팡 상품준비중 처리 실패', error);
      throw new Error(`쿠팡 상품준비중 처리 실패: ${error.message}`);
    }
  }

  /**
   * 송장 업로드 처리 API
   * (상품준비중 상태의 주문을 송장 업로드하여 배송지시 상태로 변경)
   */
  async uploadInvoices(
    payload: CoupangUploadInvoiceRequest,
  ): Promise<CoupangUploadInvoiceResponse> {
    // 요청 파라미터 검증
    const parsedReq = CoupangUploadInvoiceRequestSchema.safeParse(payload);
    if (!parsedReq.success) {
      const flattenedErrors = parsedReq.error.flatten();
      this.logger.error(
        '송장 업로드 처리 요청 파라미터 검증 실패:',
        flattenedErrors,
      );
      throw new BadRequestException({
        message: '송장 업로드 처리 입력값 유효성 검사에 실패했습니다.',
        errors: flattenedErrors.fieldErrors,
        issues: formatZodIssues(parsedReq.error.issues),
      });
    }

    const { vendorId, orderSheetInvoiceApplyDtos } = parsedReq.data;
    const config = this.getApiConfig();

    this.logger.log(
      `📦 쿠팡 송장 업로드 처리 요청 (vendorId=${vendorId}, count=${orderSheetInvoiceApplyDtos.length})`,
    );

    const path = `/v2/providers/openapi/apis/api/v4/vendors/${config.vendorId}/orders/invoices`;
    const authorization = this.generateAuthHeader(
      config.accessKey,
      config.secretKey,
      'POST',
      path,
    );
    const url = `${config.apiEndpoint}${path}`;

    try {
      const response = await firstValueFrom(
        this.http.post(url, parsedReq.data, {
          headers: {
            Authorization: authorization,
            'Content-Type': 'application/json',
          },
        }),
      );

      // 응답 검증
      const parsedRes = response.data;

      this.logger.log(
        `✅ 송장 업로드 처리 성공 (전체 상태 코드=${parsedRes.data.responseCode})`,
      );
      return parsedRes.data;
    } catch (error) {
      if (error.response) {
        this.logger.error(
          `❌ 쿠팡 송장 업로드 처리 실패: ${error.response.status} - ${error.response.data?.error?.message || error.message}`,
        );
      } else {
        this.logger.error(`❌ 쿠팡 송장 업로드 처리 실패: ${error.message}`);
      }
      throw new Error(`쿠팡 송장 업로드 처리 실패: ${error.message}`);
    }
  }

  /**
   * 송장 업데이트 처리 API
   * (잘못 등록한 운송장을 변경, 배송상태는 배송지시로 변경)
   */
  async updateInvoices(
    payload: CoupangUpdateInvoiceRequest,
  ): Promise<CoupangUpdateInvoiceResponse> {
    // 요청 파라미터 검증
    const parsedReq = CoupangUpdateInvoiceRequestSchema.safeParse(payload);
    if (!parsedReq.success) {
      const flattenedErrors = parsedReq.error.flatten();
      this.logger.error(
        '송장 업데이트 처리 요청 파라미터 검증 실패:',
        flattenedErrors,
      );
      throw new BadRequestException({
        message: '송장 업데이트 처리 입력값 유효성 검사에 실패했습니다.',
        errors: flattenedErrors.fieldErrors,
        issues: formatZodIssues(parsedReq.error.issues),
      });
    }

    const { vendorId, orderSheetInvoiceApplyDtos } = parsedReq.data;
    const config = this.getApiConfig();

    this.logger.log(
      `📦 쿠팡 송장 업데이트 처리 요청 (vendorId=${vendorId}, count=${orderSheetInvoiceApplyDtos.length})`,
    );

    const path = `/v2/providers/openapi/apis/api/v4/vendors/${config.vendorId}/orders/updateInvoices`;
    const authorization = this.generateAuthHeader(
      config.accessKey,
      config.secretKey,
      'POST',
      path,
    );
    const url = `${config.apiEndpoint}${path}`;

    try {
      const response = await firstValueFrom(
        this.http.post<CoupangUpdateInvoiceResponse>(url, parsedReq.data, {
          headers: {
            Authorization: authorization,
            'Content-Type': 'application/json',
          },
        }),
      );

      // resultMessage 그대로 출력
      for (const item of response.data.data.responseList) {
        this.logger.log(
          `📜 송장 업데이트 결과: shipmentBoxId=${item.shipmentBoxId} resultCode=${item.resultCode} resultMessage=${item.resultMessage} retry=${item.retryRequired}`,
        );
      }

      this.logger.log(
        `✅ 송장 업데이트 처리 완료 (전체 상태 코드=${response.data.data.responseCode})`,
      );
      return response.data;
    } catch (error) {
      if (error.response) {
        this.logger.error(
          `❌ 쿠팡 송장 업데이트 처리 실패: ${error.response.status} - ${error.response.data?.error?.message || error.message}`,
        );
      } else {
        this.logger.error(`❌ 쿠팡 송장 업데이트 처리 실패: ${error.message}`);
      }
      this.logger.error('❌ 쿠팡 송장 업데이트 처리 실패', error);
      throw new Error(`쿠팡 송장 업데이트 처리 실패: ${error.message}`);
    }
  }

  /**
   * 배송상태 변경 히스토리 조회 API
   * 특정 발주서의 배송상태 변경 히스토리를 조회합니다
   */
  async getDeliveryHistory(
    shipmentBoxId: string | number,
  ): Promise<CoupangDeliveryHistoryResponse> {
    try {
      const config = this.getApiConfig();

      this.logger.log(`📋 쿠팡 배송상태 변경 히스토리 조회: ${shipmentBoxId}`);

      const path = `/v2/providers/openapi/apis/api/v5/vendors/${config.vendorId}/ordersheets/${shipmentBoxId}/delivery-history`;
      const authorization = this.generateAuthHeader(
        config.accessKey,
        config.secretKey,
        'GET',
        path,
      );

      const url = `${config.apiEndpoint}${path}`;
      this.logger.log(`📡 쿠팡 배송상태 히스토리 API 호출: ${url}`);

      const response = await firstValueFrom(
        this.http.get<CoupangDeliveryHistoryResponse>(url, {
          headers: {
            Authorization: authorization,
            'Content-Type': 'application/json',
          },
        }),
      );

      // 네이버 스타일: 간단한 응답 체크만
      if (response.data.code !== 200) {
        throw new Error(
          `쿠팡 API 오류: ${response.data.code} - ${response.data.message}`,
        );
      }

      this.logger.log(
        `✅ 배송상태 히스토리 조회 성공: ${shipmentBoxId} (${response.data.data?.histories?.length || 0}건)`,
      );
      return response.data;
    } catch (error) {
      if (error.response) {
        this.logger.error(
          `❌ 쿠팡 배송상태 히스토리 조회 실패: ${error.response.status} - ${error.response.data?.error?.message || error.message}`,
        );
      } else {
        this.logger.error(
          `❌ 쿠팡 배송상태 히스토리 조회 실패: ${error.message}`,
        );
      }
      throw new Error(`쿠팡 배송상태 히스토리 조회 실패: ${error.message}`);
    }
  }
}
