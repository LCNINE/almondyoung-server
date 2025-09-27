import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as crypto from 'crypto';
import {
  CoupangAcknowledgeOrdersheetsRequest,
  CoupangAcknowledgeOrdersheetsRequestSchema,
  CoupangAcknowledgeOrdersheetsResponse,
  CoupangCompletedShipmentRequest,
  CoupangCompletedShipmentRequestSchema,
  CoupangCompletedShipmentResponse,
  CoupangConfirmReturnReceiptRequest,
  CoupangConfirmReturnReceiptRequestSchema,
  CoupangConfirmReturnReceiptResponse,
  CoupangApproveReturnRequest,
  CoupangApproveReturnRequestSchema,
  CoupangApproveReturnResponse,
  GetReturnWithdrawalHistoryParams,
  GetReturnWithdrawalHistoryParamsSchema,
  GetReturnWithdrawalHistoryResponse,
  GetReturnWithdrawalHistoryByIdsRequest,
  GetReturnWithdrawalHistoryByIdsRequestSchema,
  GetReturnWithdrawalHistoryByIdsResponse,
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
  CoupangRegisterReturnInvoiceRequest,
  CoupangRegisterReturnInvoiceRequestSchema,
  CoupangRegisterReturnInvoiceResponse,
  CoupangDeliveryHistoryRequest,
  CoupangDeliveryHistoryRequestSchema,
  CoupangDeliveryHistoryResponse,
  CoupangOrderSheet,
  CoupangOrderSheetByOrderIdResponse,
  CoupangOrderSheetListResponse,
  CoupangSingleOrderSheetResponse,
  CoupangStoppedShipmentRequest,
  CoupangStoppedShipmentRequestSchema,
  CoupangStoppedShipmentResponse,
  CoupangUpdateInvoiceRequest,
  CoupangUpdateInvoiceRequestSchema,
  CoupangUpdateInvoiceResponse,
  CoupangUploadInvoiceRequest,
  CoupangUploadInvoiceRequestSchema,
  CoupangUploadInvoiceResponse,
  GetReturnRequestsParams,
  GetReturnRequestsResponse,
  GetReturnRequestsResponseSchema,
  GetSingleReturnRequestResponse,
  CoupangUpdateStockResponse,
} from '../../zods/coupang.api.zod';
import { formatZodIssues } from '../../shared/utils';

// =================================================================
// == 1. 타입 정의 (Type Definitions)
// =================================================================

/** 쿠팡 API 기본 설정 정보 */
interface CoupangApiConfig {
  vendorId: string;
  accessKey: string;
  secretKey: string;
  apiEndpoint: string;
}

/** 발주서 목록 조회 파라미터 */
export interface GetOrderSheetsParams {
  createdAtFrom: string;
  createdAtTo: string;
  status: string;
  maxPerPage?: number;
  nextToken?: string;
}

// =================================================================
// == 2. API 클라이언트 서비스 (CoupangApiService Class)
// =================================================================

@Injectable()
export class CoupangApiService {
  private readonly logger = new Logger(CoupangApiService.name);
  private readonly apiBaseUrl = this.getApiBaseUrl();

  constructor(private readonly http: HttpService) {}

  /**
   * API Base URL을 환경에 따라 결정합니다
   */
  private getApiBaseUrl(): string {
    // Mock 서버 사용 시
    if (process.env.COUPANG_USE_MOCK_SERVER === 'true') {
      const mockUrl =
        process.env.ADAPTER_MOCK_BASE_URL || 'http://localhost:3001';
      this.logger.log(`🔧 쿠팡 Mock 서버 사용: ${mockUrl}`);
      return `${mockUrl}/coupang`;
    }

    // 실제 쿠팡 API 사용
    return (
      process.env.COUPANG_API_ENDPOINT || 'https://api-gateway.coupang.com'
    );
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
        issues: formatZodIssues(parsedReq.error.issues), // ✅ 여기서만 호출
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
        issues: formatZodIssues(parsedReq.error.issues), // ✅ 여기서만 호출
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
        issues: formatZodIssues(parsedReq.error.issues), // ✅ 여기서만 호출
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
   * 출고중지완료 처리 API
   * (고객 취소 요청으로 출고중지 상태일 때 출고중지 완료 처리)
   */
  async stoppedShipment(
    payload: CoupangStoppedShipmentRequest,
  ): Promise<CoupangStoppedShipmentResponse> {
    // 요청 파라미터 검증 (런타임 검증은 optional이지만, 여기서는 기본 체크만)
    const parsedReq = CoupangStoppedShipmentRequestSchema.safeParse(payload);
    if (!parsedReq.success) {
      const flattenedErrors = parsedReq.error.flatten();
      this.logger.error(
        '출고중지완료 처리 요청 파라미터 검증 실패:',
        flattenedErrors,
      );
      throw new BadRequestException({
        message: '출고중지완료 처리 입력값 유효성 검사에 실패했습니다.',
        errors: flattenedErrors.fieldErrors,
        issues: formatZodIssues(parsedReq.error.issues), // ✅ 여기서만 호출
      });
    }

    const { vendorId, receiptId, cancelCount } = parsedReq.data;
    const config = this.getApiConfig();

    this.logger.log(
      `📦 쿠팡 출고중지완료 처리 요청 (vendorId=${vendorId}, receiptId=${receiptId}, cancelCount=${cancelCount})`,
    );

    const path = `/v2/providers/openapi/apis/api/v4/vendors/${config.vendorId}/returnRequests/${receiptId}/stoppedShipment`;
    const authorization = this.generateAuthHeader(
      config.accessKey,
      config.secretKey,
      'PATCH',
      path,
    );
    const url = `${config.apiEndpoint}${path}`;

    try {
      const response = await firstValueFrom(
        this.http.patch<CoupangStoppedShipmentResponse>(
          url,
          {
            vendorId,
            receiptId,
            cancelCount,
          },
          {
            headers: {
              Authorization: authorization,
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      // 여기서는 응답 검증 없이 타입만 강제
      this.logger.log(
        `✅ 출고중지완료 처리 결과: ${response.data.data.resultCode} - ${response.data.data.resultMessage}`,
      );
      return response.data;
    } catch (error) {
      if (error.response) {
        this.logger.error(
          `❌ 쿠팡 출고중지완료 처리 실패: ${error.response.status} - ${error.response.data?.error?.message || error.message}`,
        );
      } else {
        this.logger.error(`❌ 쿠팡 출고중지완료 처리 실패: ${error.message}`);
      }
      this.logger.error('❌ 쿠팡 출고중지완료 처리 실패', error);
      throw new Error(`쿠팡 출고중지완료 처리 실패: ${error.message}`);
    }
  }

  /**
   * 이미출고처리 API
   * (출고중지요청/반품접수미확인 상태에서 이미 발송한 경우 상태를 변경)
   */
  async completedShipment(
    payload: CoupangCompletedShipmentRequest,
  ): Promise<CoupangCompletedShipmentResponse> {
    // 요청 파라미터 검증
    const parsedReq = CoupangCompletedShipmentRequestSchema.safeParse(payload);
    if (!parsedReq.success) {
      const flattenedErrors = parsedReq.error.flatten();
      this.logger.error(
        '이미출고처리 요청 파라미터 검증 실패:',
        flattenedErrors,
      );
      throw new BadRequestException({
        message: '이미출고처리 입력값 유효성 검사에 실패했습니다.',
        errors: flattenedErrors.fieldErrors,
        issues: formatZodIssues(parsedReq.error.issues), // ✅ 여기서만 호출
      });
    }

    const { vendorId, receiptId, deliveryCompanyCode, invoiceNumber } =
      parsedReq.data;
    const config = this.getApiConfig();

    this.logger.log(
      `📦 쿠팡 이미출고처리 요청 (vendorId=${vendorId}, receiptId=${receiptId}, deliveryCompanyCode=${deliveryCompanyCode}, invoiceNumber=${invoiceNumber})`,
    );

    const path = `/v2/providers/openapi/apis/api/v4/vendors/${config.vendorId}/returnRequests/${receiptId}/completedShipment`;
    const authorization = this.generateAuthHeader(
      config.accessKey,
      config.secretKey,
      'PATCH',
      path,
    );
    const url = `${config.apiEndpoint}${path}`;

    try {
      const response = await firstValueFrom(
        this.http.patch<CoupangCompletedShipmentResponse>(
          url,
          {
            vendorId,
            receiptId,
            deliveryCompanyCode,
            invoiceNumber,
          },
          {
            headers: {
              Authorization: authorization,
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      // 응답을 그대로 반환 (쿠팡의 resultCode/resultMessage 포함)
      this.logger.log(
        `✅ 이미출고처리 결과: ${response.data.data.resultCode} - ${response.data.data.resultMessage}`,
      );
      return response.data;
    } catch (error) {
      if (error.response) {
        this.logger.error(
          `❌ 쿠팡 이미출고처리 실패: ${error.response.status} - ${error.response.data?.error?.message || error.message}`,
        );
      } else {
        this.logger.error(`❌ 쿠팡 이미출고처리 실패: ${error.message}`);
      }
      this.logger.error('❌ 쿠팡 이미출고처리 실패', error);
      throw new Error(`쿠팡 이미출고처리 실패: ${error.message}`);
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

  /**
   * 반품/취소 요청 목록을 조회합니다.
   * @param params 조회 파라미터
   * @returns API 응답 데이터
   */
  async getReturnRequests(
    params: GetReturnRequestsParams,
  ): Promise<GetReturnRequestsResponse> {
    try {
      const config = this.getApiConfig();

      const query: Record<string, string> = {};

      if (params.createdAtFrom) {
        query.createdAtFrom = params.createdAtFrom;
      }
      // 'TcreatedAto' 오타 수정
      if (params.createdAtTo) {
        query.createdAtTo = params.createdAtTo;
      }
      if (params.searchType) {
        query.searchType = params.searchType;
      }
      if (params.status) {
        query.status = params.status;
      }
      if (params.cancelType) {
        query.cancelType = params.cancelType;
      }
      if (params.nextToken) {
        query.nextToken = params.nextToken;
      }

      const path = `/v2/providers/openapi/apis/api/v6/vendors/${config.vendorId}/returnRequests`;
      const queryParams = new URLSearchParams(query);

      const authorization = this.generateAuthHeader(
        config.accessKey,
        config.secretKey,
        'GET',
        path,
        queryParams.toString(),
      );

      const url = `${config.apiEndpoint}${path}?${queryParams.toString()}`;
      this.logger.log(`📡 쿠팡 반품/취소 목록 조회: ${url}`);

      const response = await firstValueFrom(
        this.http.get(url, {
          headers: {
            Authorization: authorization,
            'Content-Type': 'application/json',
          },
        }),
      );

      const validatedResponse = response.data;
      this.logger.log(
        `✅ 반품/취소 목록 조회 성공: ${validatedResponse.data?.length || 0}건`,
      );
      return validatedResponse;
    } catch (error) {
      this.logger.error('❌ 쿠팡 반품/취소 목록 조회 실패:', error);
      throw new Error(`쿠팡 반품/취소 목록 조회 실패: ${error.message}`);
    }
  }
  // =================================================================
  // == [추가] 반품요청 단건 조회
  // =================================================================
  /**
   * 반품/취소 요청 단건을 조회합니다 (receiptId 기준)
   * @param receiptId 취소(반품)접수번호
   * @returns API 응답 데이터
   */
  async getSingleReturnRequest(
    receiptId: number,
  ): Promise<GetSingleReturnRequestResponse> {
    try {
      const config = this.getApiConfig();
      this.logger.log(`🔍 쿠팡 반품/취소 단건 조회 (receiptId): ${receiptId}`);

      const path = `/v2/providers/openapi/apis/api/v6/vendors/${config.vendorId}/returnRequests/${receiptId}`;
      const authorization = this.generateAuthHeader(
        config.accessKey,
        config.secretKey,
        'GET',
        path,
      );
      const url = `${config.apiEndpoint}${path}`;
      this.logger.log(`📡 쿠팡 반품/취소 단건 조회 API 호출: ${url}`);

      const response = await firstValueFrom(
        this.http.get<GetSingleReturnRequestResponse>(url, {
          headers: {
            Authorization: authorization,
            'Content-Type': 'application/json',
          },
        }),
      );

      // 간단한 응답 체크
      if (response.data.code !== 200) {
        throw new Error(
          `쿠팡 API 오류: ${response.data.code} - ${response.data.message}`,
        );
      }

      this.logger.log(`✅ 쿠팡 반품/취소 단건 조회 성공: ${receiptId}`);
      return response.data;
    } catch (error) {
      if (error.response) {
        this.logger.error(
          `❌ 쿠팡 반품/취소 단건 조회 실패: ${error.response.status} - ${error.response.data?.error?.message || error.message}`,
        );
      } else {
        this.logger.error(`❌ 쿠팡 반품/취소 단건 조회 실패: ${error.message}`);
      }

      throw new Error(`쿠팡 반품/취소 단건 조회 실패: ${error.message}`);
    }
  }
  /**
   * 반품상품 입고확인 처리를 수행합니다.
   * @param payload vendorId, receiptId
   * @returns API 응답 데이터
   */
  async confirmReturnReceipt(
    payload: CoupangConfirmReturnReceiptRequest,
  ): Promise<CoupangConfirmReturnReceiptResponse> {
    const parsedReq =
      CoupangConfirmReturnReceiptRequestSchema.safeParse(payload);
    if (!parsedReq.success) {
      const flattenedErrors = parsedReq.error.flatten();
      this.logger.error(
        '❌ 반품상품 입고확인 처리 파라미터 검증 실패:',
        flattenedErrors,
      );
      throw new BadRequestException({
        message: '반품상품 입고확인 처리 입력값 유효성 검사에 실패했습니다.',
        errors: flattenedErrors.fieldErrors,
        issues: formatZodIssues(parsedReq.error.issues), // ✅ 여기서만 호출
      });
    }

    const { receiptId } = parsedReq.data;
    const config = this.getApiConfig();

    try {
      this.logger.log(`✅ 쿠팡 반품상품 입고확인 처리 요청: ${receiptId}`);

      const path = `/v2/providers/openapi/apis/api/v4/vendors/${config.vendorId}/returnRequests/${receiptId}/receiveConfirmation`;
      const authorization = this.generateAuthHeader(
        config.accessKey,
        config.secretKey,
        'PATCH',
        path,
      );
      const url = `${config.apiEndpoint}${path}`;

      const response = await firstValueFrom(
        this.http.patch<CoupangConfirmReturnReceiptResponse>(
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
        `👍 반품상품 입고확인 처리 성공: ${receiptId} - ${response.data.data.resultMessage}`,
      );
      return response.data;
    } catch (error) {
      if (error.response) {
        this.logger.error(
          `❌ 쿠팡 반품상품 입고확인 처리 실패: ${error.response.status} - ${error.response.data?.error?.message || error.message}`,
        );
      } else {
        this.logger.error(
          `❌ 쿠팡 반품상품 입고확인 처리 실패: ${error.message}`,
        );
      }

      throw new Error(`쿠팡 반품상품 입고확인 처리 실패: ${error.message}`);
    }
  }

  // =================================================================
  // == [추가] 반품요청 승인 처리
  // =================================================================
  /**
   * 반품요청을 승인 처리하여 환불을 진행합니다.
   * @param payload vendorId, receiptId, cancelCount
   * @returns API 응답 데이터
   */
  async approveReturnRequest(
    payload: CoupangApproveReturnRequest,
  ): Promise<CoupangApproveReturnResponse> {
    const parsedReq = CoupangApproveReturnRequestSchema.safeParse(payload);
    if (!parsedReq.success) {
      const flattenedErrors = parsedReq.error.flatten();
      this.logger.error(
        '❌ 반품요청 승인 처리 파라미터 검증 실패:',
        flattenedErrors,
      );
      throw new BadRequestException({
        message: '반품요청 승인 처리 입력값 유효성 검사에 실패했습니다.',
        errors: flattenedErrors.fieldErrors,
        issues: formatZodIssues(parsedReq.error.issues), // ✅ 여기서만 호출
      });
    }

    const { receiptId } = parsedReq.data;
    const config = this.getApiConfig();

    try {
      this.logger.log(`✅ 쿠팡 반품요청 승인 처리 요청: ${receiptId}`);

      const path = `/v2/providers/openapi/apis/api/v4/vendors/${config.vendorId}/returnRequests/${receiptId}/approval`;
      const authorization = this.generateAuthHeader(
        config.accessKey,
        config.secretKey,
        'PATCH',
        path,
      );
      const url = `${config.apiEndpoint}${path}`;

      const response = await firstValueFrom(
        this.http.patch<CoupangApproveReturnResponse>(url, parsedReq.data, {
          headers: {
            Authorization: authorization,
            'Content-Type': 'application/json',
          },
        }),
      );

      this.logger.log(
        `👍 반품요청 승인 처리 성공: ${receiptId} - ${response.data.message}`,
      );
      return response.data;
    } catch (error) {
      if (error.response) {
        this.logger.error(
          `❌ 쿠팡 반품요청 승인 처리 실패: ${error.response.status} - ${error.response.data?.error?.message || error.message}`,
        );
      } else {
        this.logger.error(`❌ 쿠팡 반품요청 승인 처리 실패: ${error.message}`);
      }
      throw new Error(`쿠팡 반품요청 승인 처리 실패: ${error.message}`);
    }
  }

  // =================================================================
  // == [추가] 반품 철회 이력 기간별 조회
  // =================================================================
  /**
   * 기간별로 철회된 반품의 이력을 조회합니다.
   * @param params 조회 기간 및 페이징 정보
   * @returns API 응답 데이터
   */
  async getReturnWithdrawalHistory(
    params: GetReturnWithdrawalHistoryParams,
  ): Promise<GetReturnWithdrawalHistoryResponse> {
    const parsedParams =
      GetReturnWithdrawalHistoryParamsSchema.safeParse(params);
    if (!parsedParams.success) {
      const flattenedErrors = parsedParams.error.flatten();
      this.logger.error(
        '❌ 반품 철회 이력 조회 파라미터 검증 실패:',
        flattenedErrors,
      );
      throw new BadRequestException({
        message: '반품 철회 이력 조회 입력값 유효성 검사에 실패했습니다.',
        errors: flattenedErrors.fieldErrors,
        issues: formatZodIssues(parsedParams.error.issues), // ✅ 여기서만 호출
      });
    }

    const config = this.getApiConfig();
    try {
      const query = new URLSearchParams({
        dateFrom: parsedParams.data.dateFrom,
        dateTo: parsedParams.data.dateTo,
        pageIndex: String(parsedParams.data.pageIndex),
        sizePerPage: String(parsedParams.data.sizePerPage),
      }).toString();

      this.logger.log(`🔍 쿠팡 반품 철회 이력 조회 요청: ${query}`);

      const path = `/v2/providers/openapi/apis/api/v4/vendors/${config.vendorId}/returnWithdrawRequests`;
      const authorization = this.generateAuthHeader(
        config.accessKey,
        config.secretKey,
        'GET',
        path,
        query,
      );
      const url = `${config.apiEndpoint}${path}?${query}`;

      const response = await firstValueFrom(
        this.http.get<GetReturnWithdrawalHistoryResponse>(url, {
          headers: {
            Authorization: authorization,
            'Content-Type': 'application/json',
          },
        }),
      );

      this.logger.log(
        `👍 반품 철회 이력 조회 성공: ${response.data.data.length}건`,
      );
      return response.data;
    } catch (error) {
      if (error.response) {
        this.logger.error(
          `❌ 쿠팡 반품 철회 이력 조회 실패: ${error.response.status} - ${error.response.data?.error?.message || error.message}`,
        );
      } else {
        this.logger.error(`❌ 쿠팡 반품 철회 이력 조회 실패: ${error.message}`);
      }
      throw new Error(`쿠팡 반품 철회 이력 조회 실패: ${error.message}`);
    }
  }

  // =================================================================
  // == [추가] 반품 철회 이력 접수번호로 조회
  // =================================================================
  /**
   * 접수번호 목록으로 철회된 반품의 이력을 조회합니다.
   * @param payload 조회할 cancelIds 목록
   * @returns API 응답 데이터
   */
  async getReturnWithdrawalHistoryByIds(
    payload: GetReturnWithdrawalHistoryByIdsRequest,
  ): Promise<GetReturnWithdrawalHistoryByIdsResponse> {
    const parsedReq =
      GetReturnWithdrawalHistoryByIdsRequestSchema.safeParse(payload);
    if (!parsedReq.success) {
      const flattenedErrors = parsedReq.error.flatten();
      this.logger.error(
        '❌ 반품 철회 이력(ID) 조회 파라미터 검증 실패:',
        flattenedErrors,
      );
      throw new BadRequestException({
        message: '반품 철회 이력(ID) 조회 입력값 유효성 검사에 실패했습니다.',
        errors: flattenedErrors.fieldErrors,
        issues: formatZodIssues(parsedReq.error.issues), // ✅ 여기서만 호출
      });
    }

    const config = this.getApiConfig();
    try {
      const { cancelIds } = parsedReq.data;
      this.logger.log(
        `🔍 쿠팡 반품 철회 이력(ID) 조회 요청: ${cancelIds.length}건`,
      );

      const path = `/v2/providers/openapi/apis/api/v4/vendors/${config.vendorId}/returnWithdrawList`;
      const authorization = this.generateAuthHeader(
        config.accessKey,
        config.secretKey,
        'POST',
        path,
      );
      const url = `${config.apiEndpoint}${path}`;

      const response = await firstValueFrom(
        this.http.post<GetReturnWithdrawalHistoryByIdsResponse>(
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
        `👍 반품 철회 이력(ID) 조회 성공: ${response.data.data.length}건`,
      );
      return response.data;
    } catch (error) {
      if (error.response) {
        this.logger.error(
          `❌ 쿠팡 반품 철회 이력(ID) 조회 실패: ${error.response.status} - ${error.response.data?.error?.message || error.message}`,
        );
      } else {
        this.logger.error(
          `❌ 쿠팡 반품 철회 이력(ID) 조회 실패: ${error.message}`,
        );
      }
      throw new Error(`쿠팡 반품 철회 이력(ID) 조회 실패: ${error.message}`);
    }
  }

  // =================================================================
  // == [추가] 회수송장 등록
  // =================================================================
  /**
   * 반품/교환에 대한 회수송장을 직접 등록합니다.
   * @param payload 송장 등록 정보
   * @returns API 응답 데이터
   */
  async registerReturnInvoice(
    payload: CoupangRegisterReturnInvoiceRequest,
  ): Promise<CoupangRegisterReturnInvoiceResponse> {
    const parsedReq =
      CoupangRegisterReturnInvoiceRequestSchema.safeParse(payload);
    if (!parsedReq.success) {
      const flattenedErrors = parsedReq.error.flatten();
      this.logger.error(
        '❌ 회수송장 등록 파라미터 검증 실패:',
        flattenedErrors,
      );
      throw new BadRequestException({
        message: '회수송장 등록 입력값 유효성 검사에 실패했습니다.',
        errors: flattenedErrors.fieldErrors,
        issues: formatZodIssues(parsedReq.error.issues), // ✅ 여기서만 호출
      });
    }

    const config = this.getApiConfig();
    try {
      this.logger.log(
        `🚚 쿠팡 회수송장 등록 요청: receiptId=${parsedReq.data.receiptId}`,
      );

      const path = `/v2/providers/openapi/apis/api/v4/vendors/${config.vendorId}/return-exchange-invoices/manual`;
      const authorization = this.generateAuthHeader(
        config.accessKey,
        config.secretKey,
        'POST',
        path,
      );
      const url = `${config.apiEndpoint}${path}`;

      const response = await firstValueFrom(
        this.http.post<CoupangRegisterReturnInvoiceResponse>(
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
        `👍 회수송장 등록 성공: receiptId=${response.data.data.receiptId}`,
      );
      return response.data;
    } catch (error) {
      if (error.response) {
        this.logger.error(
          `❌ 쿠팡 회수송장 등록 실패: ${error.response.status} - ${error.response.data?.error?.message || error.message}`,
        );
      } else {
        this.logger.error(`❌ 쿠팡 회수송장 등록 실패: ${error.message}`);
      }
      throw new Error(`쿠팡 회수송장 등록 실패: ${error.message}`);
    }
  }

  // =================================================================
  // == [추가] 교환요청 목록 조회
  // =================================================================
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
        issues: formatZodIssues(parsedParams.error.issues), // ✅ 여기서만 호출
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

  // =================================================================
  // == [추가] 교환요청 상품 입고확인 처리
  // =================================================================
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
        issues: formatZodIssues(parsedReq.error.issues), // ✅ 여기서만 호출
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

  // =================================================================
  // == [추가] 교환요청 거부 처리
  // =================================================================
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
        issues: formatZodIssues(parsedReq.error.issues), // ✅ 여기서만 호출
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

  // =================================================================
  // == [추가] 교환상품 송장 업로드 처리
  // =================================================================
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
        issues: formatZodIssues(parsedReq.error.issues), // ✅ 여기서만 호출
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
  // =================================================================
  // == 상품/재고 (Product/Stock)
  // =================================================================
  /**
   * 특정 상품 옵션(vendorItemId)의 재고 수량을 변경합니다.
   * @param vendorItemId 옵션 ID
   * @param quantity 변경할 재고 수량
   * @returns API 응답 데이터
   */
  async updateStock(
    vendorItemId: number,
    quantity: number,
  ): Promise<CoupangUpdateStockResponse> {
    const config = this.getApiConfig();
    try {
      this.logger.log(
        `📦 쿠팡 재고 변경 요청: vendorItemId=${vendorItemId}, quantity=${quantity}`,
      );

      const path = `/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/${vendorItemId}/quantities/${quantity}`;
      const authorization = this.generateAuthHeader(
        config.accessKey,
        config.secretKey,
        'PUT',
        path,
      );
      const url = `${config.apiEndpoint}${path}`;

      const response = await firstValueFrom(
        // 이 API는 요청 본문(body)이 필요 없습니다.
        this.http.put<CoupangUpdateStockResponse>(url, null, {
          headers: {
            Authorization: authorization,
            'Content-Type': 'application/json',
          },
        }),
      );

      this.logger.log(`👍 재고 변경 완료: ${vendorItemId} -> ${quantity}개`);
      return response.data;
    } catch (error) {
      if (error.response) {
        this.logger.error(
          `❌ 쿠팡 재고 변경 실패: ${error.response.status} - ${error.response.data?.error?.message || error.message}`,
        );
      } else {
        this.logger.error(`❌ 쿠팡 재고 변경 실패: ${error.message}`);
      }
      throw new Error(`쿠팡 재고 변경 실패: ${error.message}`);
    }
  }

  // =================================================================
  // == 유틸리티 메서드 (Utility Methods)
  // ...
  // =================================================================
  // == 유틸리티 메서드 (Utility Methods)
  // =================================================================

  /**
   * 환경변수에서 쿠팡 API 설정을 가져옵니다
   * @returns 쿠팡 API 설정 정보 이게 쿠팡 공식문서 통해 만든것
   */
  private getApiConfig(): CoupangApiConfig {
    const vendorId = process.env.COUPANG_VENDOR_ID;
    const accessKey = process.env.COUPANG_ACCESS_KEY;
    const secretKey = process.env.COUPANG_SECRET_KEY;
    const apiEndpoint = this.apiBaseUrl;

    if (!vendorId || !accessKey || !secretKey) {
      throw new Error('쿠팡 API 인증 정보가 설정되지 않았습니다');
    }

    return { vendorId, accessKey, secretKey, apiEndpoint };
  }

  /**
   * 쿠팡 API 인증 헤더 생성 (쿠팡 공식 Node 예제 기반)
   */
  private generateAuthHeader(
    accessKey: string,
    secretKey: string,
    method: string,
    path: string,
    queryString: string = '',
  ): string {
    const datetime =
      new Date()
        .toISOString()
        .slice(2, 19)
        .replace(/:/g, '')
        .replace(/-/g, '') + 'Z';

    const message = datetime + method + path + queryString;
    const signature = crypto
      .createHmac('sha256', secretKey)
      .update(message)
      .digest('hex');

    return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${datetime}, signature=${signature}`;
  }
}
