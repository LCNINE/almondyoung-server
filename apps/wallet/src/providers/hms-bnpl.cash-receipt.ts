import { Injectable, Logger } from '@nestjs/common';
import {
  CashReceiptPort,
  CashReceiptRequest,
  CashReceiptResult,
} from './payment-provider.interface';
import { HmsAPI, ApiClientFactory } from 'hms-api-wrapper';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { generateUUIDv7 } from '../shared/utils/id-generator';
import { WalletExecutor } from '../shared/database';

/**
 * HMS BNPL 현금영수증 Provider
 *
 * 책임:
 * - HMS API를 통한 현금영수증 발급
 * - DB에 발급 결과 저장 (cashReceiptEvents, cashReceiptEventDetails)
 * - 개인사업자/법인 구분 처리
 * - B2B 이커머스 특성 반영 (공급가액 + 부가세)
 */
@Injectable()
export class HmsBnplCashReceiptProvider implements CashReceiptPort {
  private readonly logger = new Logger(HmsBnplCashReceiptProvider.name);
  private readonly hmsApi: HmsAPI;

  constructor(private readonly db: DbService<typeof schema>) {
    this.hmsApi = ApiClientFactory.create({
      swKey: process.env.SW_KEY || '',
      custKey: process.env.CUST_KEY || '',
      isTest: process.env.NODE_ENV !== 'production',
      useMock: false,
    }) as HmsAPI;
  }

  async issue(request: CashReceiptRequest): Promise<CashReceiptResult> {
    this.logger.log(
      `➡️ HMS 현금영수증 발급 요청 - User: ${request.userId}, Amount: ${request.totalAmount}`,
    );

    try {
      return await this.db.db.transaction(async (tx) => {
        // 1. 금액 계산 (B2B 특성: 공급가액 + 부가세)
        const supplyAmount = Math.floor(request.totalAmount / 1.1);
        const vatAmount = request.totalAmount - supplyAmount;

        // 2. HMS API 호출을 위한 요청 데이터 구성
        const custId = process.env.HMS_CUST_ID || 'DEFAULT_CUST';
        const cashReceiptId = `CR_${request.userId}_${Date.now()}`;

        // 현금영수증 번호: 사업자번호 우선, 없으면 휴대폰번호
        const receiptNumber =
          request.customerBusinessNumber || request.customerPhone || '';

        const hmsRequest = {
          cashReceiptId,
          receiptNumber,
          supplyAmount,
          vatAmount,
          serviceAmount: 0, // 서비스 금액 (일반적으로 0)
          totalAmount: request.totalAmount,
        };

        this.logger.debug('HMS API 요청 데이터:', hmsRequest);

        // 3. HMS API 호출
        const hmsResponse = await this.hmsApi.cashReceipts.create(
          custId,
          hmsRequest,
        );

        this.logger.debug('HMS API 응답:', hmsResponse);

        // 4. 성공 여부 확인 (HMS API 응답 구조에 맞게)
        const cashReceiptDetails = hmsResponse.cashReceipt;
        const isSuccess = cashReceiptDetails.result.flag === 'Y';
        const approvalNumber = cashReceiptDetails.receiptApprovalNumber;
        const receiptDate = cashReceiptDetails.receiptDate;

        // 5. DB에 이벤트 저장
        const eventId = generateUUIDv7();

        // 현금영수증 이벤트 저장
        await tx.insert(schema.cashReceiptEvents).values({
          id: eventId,
          userId: request.userId,
          cashReceiptId: cashReceiptDetails.cashReceiptId,
          eventType: 'ISSUE',
          requestPayload: hmsRequest,
          responsePayload: hmsResponse,
        });

        // 현금영수증 상세 정보 저장
        await tx.insert(schema.cashReceiptEventDetails).values({
          id: generateUUIDv7(),
          eventId,
          supplyAmount,
          vatAmount,
          serviceAmount: 0,
          totalAmount: request.totalAmount,
          receiptApprovalNumber: isSuccess ? approvalNumber : null,
          receiptDate: isSuccess ? receiptDate : null,
          receiptPurpose: this.mapPurposeToString(request.purpose),
        });

        if (isSuccess) {
          this.logger.log(
            `✅ HMS 현금영수증 발급 성공 - ReceiptId: ${cashReceiptDetails.cashReceiptId}, ApprovalNumber: ${approvalNumber}`,
          );

          return {
            success: true,
            receiptId: cashReceiptDetails.cashReceiptId,
            approvalNumber,
            receiptDate,
            code: 'SUCCESS',
            message: '현금영수증 발급 완료',
            raw: hmsResponse,
          };
        } else {
          const errorMessage =
            cashReceiptDetails.result.message || '현금영수증 발급 실패';
          this.logger.warn(`⚠️ HMS 현금영수증 발급 실패: ${errorMessage}`);

          return {
            success: false,
            code: 'HMS_CASH_RECEIPT_FAILED',
            message: errorMessage,
            raw: hmsResponse,
          };
        }
      });
    } catch (error: any) {
      this.logger.error(
        `❌ HMS 현금영수증 발급 오류: ${error.message}`,
        error.stack,
      );

      // TODO: 향후 재시도 로직 추가 예정
      return {
        success: false,
        code: 'HMS_CASH_RECEIPT_ERROR',
        message: `현금영수증 발급 중 오류 발생: ${error.message}`,
        raw: error,
      };
    }
  }

  /**
   * 현금영수증 용도를 HMS API에 맞는 문자열로 변환
   */
  private mapPurposeToString(
    purpose: 'INCOME_DEDUCTION' | 'BUSINESS_EXPENSE',
  ): string {
    switch (purpose) {
      case 'INCOME_DEDUCTION':
        return '현금(소득공제)';
      case 'BUSINESS_EXPENSE':
        return '현금(사업비)';
      default:
        return '현금(소득공제)';
    }
  }

  // TODO: 향후 취소 기능 추가 예정
  // async cancel(receiptId: string, reason: string): Promise<CashReceiptResult> {
  //   // HMS API를 통한 현금영수증 취소 로직
  //   // 1. HMS API 호출: this.hmsApi.batchCms.cashReceipt.cancel()
  //   // 2. DB 이벤트 저장: eventType = 'CANCEL'
  //   // 3. 상세 정보 업데이트: cancelDate, cancelApprovalNumber, cancelReason
  // }
}
