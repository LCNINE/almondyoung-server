import { Injectable, BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { CoupangBaseClient } from './coupang-base.client.service';
import {
  CoupangStoppedShipmentRequest,
  CoupangStoppedShipmentRequestSchema,
  CoupangStoppedShipmentResponse,
  CoupangCompletedShipmentRequest,
  CoupangCompletedShipmentRequestSchema,
  CoupangCompletedShipmentResponse,
  GetReturnRequestsParams,
  GetReturnRequestsResponse,
  GetSingleReturnRequestResponse,
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
  CoupangRegisterReturnInvoiceRequest,
  CoupangRegisterReturnInvoiceRequestSchema,
  CoupangRegisterReturnInvoiceResponse,
} from '../../../zods/coupang';
import { formatZodIssues } from '../../../shared/utils';

/**
 * 쿠팡 반품/취소 클라이언트
 *
 * 반품 요청 조회, 반품 처리, 출고중지, 회수송장 등 반품 도메인 API를 담당합니다.
 *
 * @author Channel Adapter Team
 * @version 2.0.0
 */
@Injectable()
export class CoupangReturnClient extends CoupangBaseClient {
  constructor(http: HttpService) {
    super(http);
  }

  /**
   * 반품/취소 요청 목록을 조회합니다.
   * @param params 조회 파라미터
   * @returns API 응답 데이터
   */
  async getReturnRequests(params: GetReturnRequestsParams): Promise<GetReturnRequestsResponse> {
    try {
      const config = this.getApiConfig();

      const query: Record<string, string> = {};

      if (params.createdAtFrom) {
        query.createdAtFrom = params.createdAtFrom;
      }
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
      this.logger.log(`📡 쿠팡 반품/취소 목록 조회: ${path}`);

      const validatedResponse = await this.send<GetReturnRequestsResponse>('GET', path, { query: queryParams });
      this.logger.log(`✅ 반품/취소 목록 조회 성공: ${validatedResponse.data?.length || 0}건`);
      return validatedResponse;
    } catch (error) {
      this.logger.error('❌ 쿠팡 반품/취소 목록 조회 실패:', error);
      throw new Error(`쿠팡 반품/취소 목록 조회 실패: ${error.message}`);
    }
  }

  /**
   * 반품/취소 요청 단건을 조회합니다 (receiptId 기준)
   * @param receiptId 취소(반품)접수번호
   * @returns API 응답 데이터
   */
  async getSingleReturnRequest(receiptId: string): Promise<GetSingleReturnRequestResponse> {
    try {
      const config = this.getApiConfig();
      this.logger.log(`🔍 쿠팡 반품/취소 단건 조회 (receiptId): ${receiptId}`);

      const path = `/v2/providers/openapi/apis/api/v6/vendors/${config.vendorId}/returnRequests/${receiptId}`;
      const body = await this.send<GetSingleReturnRequestResponse>('GET', path);

      // 간단한 응답 체크
      if (body.code !== 200) {
        throw new Error(`쿠팡 API 오류: ${body.code} - ${body.message}`);
      }

      this.logger.log(`✅ 쿠팡 반품/취소 단건 조회 성공: ${receiptId}`);
      return body;
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
   * 출고중지완료 처리 API
   * (고객 취소 요청으로 출고중지 상태일 때 출고중지 완료 처리)
   */
  async stoppedShipment(payload: CoupangStoppedShipmentRequest): Promise<CoupangStoppedShipmentResponse> {
    const parsedReq = CoupangStoppedShipmentRequestSchema.safeParse(payload);
    if (!parsedReq.success) {
      const flattenedErrors = parsedReq.error.flatten();
      this.logger.error('출고중지완료 처리 요청 파라미터 검증 실패:', flattenedErrors);
      throw new BadRequestException({
        message: '출고중지완료 처리 입력값 유효성 검사에 실패했습니다.',
        errors: flattenedErrors.fieldErrors,
        issues: formatZodIssues(parsedReq.error.issues),
      });
    }

    const { vendorId, receiptId, cancelCount } = parsedReq.data;
    const config = this.getApiConfig();

    this.logger.log(
      `📦 쿠팡 출고중지완료 처리 요청 (vendorId=${vendorId}, receiptId=${receiptId}, cancelCount=${cancelCount})`,
    );

    const path = `/v2/providers/openapi/apis/api/v4/vendors/${config.vendorId}/returnRequests/${receiptId}/stoppedShipment`;

    try {
      const response = await this.send<CoupangStoppedShipmentResponse>('PATCH', path, {
        body: { vendorId, receiptId, cancelCount },
      });

      this.logger.log(
        `✅ 출고중지완료 처리 결과: ${response.data.resultCode} - ${response.data.resultMessage}`,
      );
      return response;
    } catch (error) {
      if (error.response) {
        this.logger.error(
          `❌ 쿠팡 출고중지완료 처리 실패: ${error.response.status} - ${error.response.data?.error?.message || error.message}`,
        );
      } else {
        this.logger.error(`❌ 쿠팡 출고중지완료 처리 실패: ${error.message}`);
      }
      this.logger.error('❌ 쿠팡 출고중지완료 처리 실패', error);
      // HTTP 상태를 잃지 않게 싣는다 — 호출자가 4xx(다시 해도 같다)와 5xx·네트워크(재시도)를 가른다
      throw Object.assign(new Error(`쿠팡 출고중지완료 처리 실패: ${error.message}`), {
        status: responseStatusOf(error),
        cause: error,
      });
    }
  }

  /**
   * 이미출고처리 API
   * (출고중지요청/반품접수미확인 상태에서 이미 발송한 경우 상태를 변경)
   */
  async completedShipment(payload: CoupangCompletedShipmentRequest): Promise<CoupangCompletedShipmentResponse> {
    const parsedReq = CoupangCompletedShipmentRequestSchema.safeParse(payload);
    if (!parsedReq.success) {
      const flattenedErrors = parsedReq.error.flatten();
      this.logger.error('이미출고처리 요청 파라미터 검증 실패:', flattenedErrors);
      throw new BadRequestException({
        message: '이미출고처리 입력값 유효성 검사에 실패했습니다.',
        errors: flattenedErrors.fieldErrors,
        issues: formatZodIssues(parsedReq.error.issues),
      });
    }

    const { vendorId, receiptId, deliveryCompanyCode, invoiceNumber } = parsedReq.data;
    const config = this.getApiConfig();

    this.logger.log(
      `📦 쿠팡 이미출고처리 요청 (vendorId=${vendorId}, receiptId=${receiptId}, deliveryCompanyCode=${deliveryCompanyCode}, invoiceNumber=${invoiceNumber})`,
    );

    const path = `/v2/providers/openapi/apis/api/v4/vendors/${config.vendorId}/returnRequests/${receiptId}/completedShipment`;

    try {
      const response = await this.send<CoupangCompletedShipmentResponse>('PATCH', path, {
        body: { vendorId, receiptId, deliveryCompanyCode, invoiceNumber },
      });

      this.logger.log(`✅ 이미출고처리 결과: ${response.data.resultCode} - ${response.data.resultMessage}`);
      return response;
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
   * 반품상품 입고확인 처리를 수행합니다.
   * @param payload vendorId, receiptId
   * @returns API 응답 데이터
   */
  async confirmReturnReceipt(
    payload: CoupangConfirmReturnReceiptRequest,
  ): Promise<CoupangConfirmReturnReceiptResponse> {
    const parsedReq = CoupangConfirmReturnReceiptRequestSchema.safeParse(payload);
    if (!parsedReq.success) {
      const flattenedErrors = parsedReq.error.flatten();
      this.logger.error('❌ 반품상품 입고확인 처리 파라미터 검증 실패:', flattenedErrors);
      throw new BadRequestException({
        message: '반품상품 입고확인 처리 입력값 유효성 검사에 실패했습니다.',
        errors: flattenedErrors.fieldErrors,
        issues: formatZodIssues(parsedReq.error.issues),
      });
    }

    const { receiptId } = parsedReq.data;
    const config = this.getApiConfig();

    try {
      this.logger.log(`✅ 쿠팡 반품상품 입고확인 처리 요청: ${receiptId}`);

      const path = `/v2/providers/openapi/apis/api/v4/vendors/${config.vendorId}/returnRequests/${receiptId}/receiveConfirmation`;
      const response = await this.send<CoupangConfirmReturnReceiptResponse>('PATCH', path, {
        body: parsedReq.data,
      });

      this.logger.log(`👍 반품상품 입고확인 처리 성공: ${receiptId} - ${response.data.resultMessage}`);
      return response;
    } catch (error) {
      if (error.response) {
        this.logger.error(
          `❌ 쿠팡 반품상품 입고확인 처리 실패: ${error.response.status} - ${error.response.data?.error?.message || error.message}`,
        );
      } else {
        this.logger.error(`❌ 쿠팡 반품상품 입고확인 처리 실패: ${error.message}`);
      }

      throw new Error(`쿠팡 반품상품 입고확인 처리 실패: ${error.message}`);
    }
  }

  /**
   * 반품요청을 승인 처리하여 환불을 진행합니다.
   * @param payload vendorId, receiptId, cancelCount
   * @returns API 응답 데이터
   */
  async approveReturnRequest(payload: CoupangApproveReturnRequest): Promise<CoupangApproveReturnResponse> {
    const parsedReq = CoupangApproveReturnRequestSchema.safeParse(payload);
    if (!parsedReq.success) {
      const flattenedErrors = parsedReq.error.flatten();
      this.logger.error('❌ 반품요청 승인 처리 파라미터 검증 실패:', flattenedErrors);
      throw new BadRequestException({
        message: '반품요청 승인 처리 입력값 유효성 검사에 실패했습니다.',
        errors: flattenedErrors.fieldErrors,
        issues: formatZodIssues(parsedReq.error.issues),
      });
    }

    const { receiptId } = parsedReq.data;
    const config = this.getApiConfig();

    try {
      this.logger.log(`✅ 쿠팡 반품요청 승인 처리 요청: ${receiptId}`);

      const path = `/v2/providers/openapi/apis/api/v4/vendors/${config.vendorId}/returnRequests/${receiptId}/approval`;
      const response = await this.send<CoupangApproveReturnResponse>('PATCH', path, { body: parsedReq.data });

      this.logger.log(`👍 반품요청 승인 처리 성공: ${receiptId} - ${response.message}`);
      return response;
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

  /**
   * 기간별로 철회된 반품의 이력을 조회합니다.
   * @param params 조회 기간 및 페이징 정보
   * @returns API 응답 데이터
   */
  async getReturnWithdrawalHistory(
    params: GetReturnWithdrawalHistoryParams,
  ): Promise<GetReturnWithdrawalHistoryResponse> {
    const parsedParams = GetReturnWithdrawalHistoryParamsSchema.safeParse(params);
    if (!parsedParams.success) {
      const flattenedErrors = parsedParams.error.flatten();
      this.logger.error('❌ 반품 철회 이력 조회 파라미터 검증 실패:', flattenedErrors);
      throw new BadRequestException({
        message: '반품 철회 이력 조회 입력값 유효성 검사에 실패했습니다.',
        errors: flattenedErrors.fieldErrors,
        issues: formatZodIssues(parsedParams.error.issues),
      });
    }

    const config = this.getApiConfig();
    try {
      const query = new URLSearchParams({
        dateFrom: parsedParams.data.dateFrom,
        dateTo: parsedParams.data.dateTo,
        pageIndex: String(parsedParams.data.pageIndex),
        sizePerPage: String(parsedParams.data.sizePerPage),
      });

      this.logger.log(`🔍 쿠팡 반품 철회 이력 조회 요청: ${query.toString()}`);

      const path = `/v2/providers/openapi/apis/api/v4/vendors/${config.vendorId}/returnWithdrawRequests`;
      const response = await this.send<GetReturnWithdrawalHistoryResponse>('GET', path, { query });

      this.logger.log(`👍 반품 철회 이력 조회 성공: ${response.data.length}건`);
      return response;
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

  /**
   * 접수번호 목록으로 철회된 반품의 이력을 조회합니다.
   * @param payload 조회할 cancelIds 목록
   * @returns API 응답 데이터
   */
  async getReturnWithdrawalHistoryByIds(
    payload: GetReturnWithdrawalHistoryByIdsRequest,
  ): Promise<GetReturnWithdrawalHistoryByIdsResponse> {
    const parsedReq = GetReturnWithdrawalHistoryByIdsRequestSchema.safeParse(payload);
    if (!parsedReq.success) {
      const flattenedErrors = parsedReq.error.flatten();
      this.logger.error('❌ 반품 철회 이력(ID) 조회 파라미터 검증 실패:', flattenedErrors);
      throw new BadRequestException({
        message: '반품 철회 이력(ID) 조회 입력값 유효성 검사에 실패했습니다.',
        errors: flattenedErrors.fieldErrors,
        issues: formatZodIssues(parsedReq.error.issues),
      });
    }

    const config = this.getApiConfig();
    try {
      const { cancelIds } = parsedReq.data;
      this.logger.log(`🔍 쿠팡 반품 철회 이력(ID) 조회 요청: ${cancelIds.length}건`);

      const path = `/v2/providers/openapi/apis/api/v4/vendors/${config.vendorId}/returnWithdrawList`;
      const response = await this.send<GetReturnWithdrawalHistoryByIdsResponse>('POST', path, {
        body: parsedReq.data,
      });

      this.logger.log(`👍 반품 철회 이력(ID) 조회 성공: ${response.data.length}건`);
      return response;
    } catch (error) {
      if (error.response) {
        this.logger.error(
          `❌ 쿠팡 반품 철회 이력(ID) 조회 실패: ${error.response.status} - ${error.response.data?.error?.message || error.message}`,
        );
      } else {
        this.logger.error(`❌ 쿠팡 반품 철회 이력(ID) 조회 실패: ${error.message}`);
      }
      throw new Error(`쿠팡 반품 철회 이력(ID) 조회 실패: ${error.message}`);
    }
  }

  /**
   * 반품/교환에 대한 회수송장을 직접 등록합니다.
   * @param payload 송장 등록 정보
   * @returns API 응답 데이터
   */
  async registerReturnInvoice(
    payload: CoupangRegisterReturnInvoiceRequest,
  ): Promise<CoupangRegisterReturnInvoiceResponse> {
    const parsedReq = CoupangRegisterReturnInvoiceRequestSchema.safeParse(payload);
    if (!parsedReq.success) {
      const flattenedErrors = parsedReq.error.flatten();
      this.logger.error('❌ 회수송장 등록 파라미터 검증 실패:', flattenedErrors);
      throw new BadRequestException({
        message: '회수송장 등록 입력값 유효성 검사에 실패했습니다.',
        errors: flattenedErrors.fieldErrors,
        issues: formatZodIssues(parsedReq.error.issues),
      });
    }

    const config = this.getApiConfig();
    try {
      this.logger.log(`🚚 쿠팡 회수송장 등록 요청: receiptId=${parsedReq.data.receiptId}`);

      const path = `/v2/providers/openapi/apis/api/v4/vendors/${config.vendorId}/return-exchange-invoices/manual`;
      const response = await this.send<CoupangRegisterReturnInvoiceResponse>('POST', path, {
        body: parsedReq.data,
      });

      this.logger.log(`👍 회수송장 등록 성공: receiptId=${response.data.receiptId}`);
      return response;
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
}

/** axios 오류의 `response.status` — 응답이 없거나(네트워크) 숫자가 아니면 undefined */
function responseStatusOf(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number') {
    return error.status; // CoupangBaseClient.send 가 실어 둔 상태 코드
  }
  if (typeof error !== 'object' || error === null || !('response' in error)) return undefined;
  const { response } = error;
  if (typeof response !== 'object' || response === null || !('status' in response)) return undefined;
  return typeof response.status === 'number' ? response.status : undefined;
}
