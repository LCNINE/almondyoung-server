// adapters/hms-bnpl-payment.adapter.ts
import { Injectable, Logger } from '@nestjs/common';
import { HmsAPI, MockHmsAPI } from 'hms-api-wrapper';
import { HmsApiFactory } from '../shared/utils/hms-api.factory';
import { getTsid } from 'tsid-ts';
import { ulid } from 'ulid';
import {
  PaymentGateway,
  PaymentMetadata,
  PaymentResult,
  RefundResult,
  CaptureResult,
  PaymentMethodRegistrationRequest,
  PaymentMethodRegistrationResult,
} from '../interfaces/payment-gateway.interface';
import { BnplMethodGateway } from '../interfaces/payment-method-gateways.interface';
import { Money } from '../shared/utils/money.util';
import { BnplLedgerService } from '../services/bnpl-ledger.service';

/**
 * HMS BNPL 결제 어댑터 (표준 간소화)
 * - processPayment(): 내부 승인만 (실제 출금X)
 * - capturePayment(): 실제 HMS 출금 실행 (배치)
 * - refundPayment(): 결제 환불
 * - registerPaymentMethod(): BNPL 회원 등록
 */
@Injectable()
export class HmsBnplPaymentAdapter
  implements PaymentGateway, BnplMethodGateway
{
  private readonly logger = new Logger(HmsBnplPaymentAdapter.name);
  private readonly hmsApi: HmsAPI | MockHmsAPI;

  constructor(private readonly bnplLedger: BnplLedgerService) {
    // 🎯 BNPL은 항상 Mock 서버 사용 (Test 서버는 수동 승인 필요)
    this.hmsApi = HmsApiFactory.createForBnpl();
    this.logger.log(
      `HMS BNPL 어댑터 초기화 완료 - Mock 서버 사용 (수동 승인 시뮬레이션)`,
    );
  }

  /**
   * BNPL 결제 승인 (내부 한도 관리 + HMS API 호출)
   */
  async processPayment(
    amount: number,
    currency: string = 'KRW',
    metadata?: PaymentMetadata,
  ): Promise<PaymentResult> {
    const amountKRW = Money.toKRWInt(amount);
    Money.validate(amountKRW);

    this.logger.log(
      `HMS BNPL 승인 처리: ${metadata?.bnplAccountId}, 금액: ${amountKRW}KRW`,
    );

    try {
      // 1. 내부 한도 관리 (BnplLedgerService)
      const authResult = await this.bnplLedger.authorize(
        metadata?.bnplAccountId!,
        amountKRW,
        metadata?.sessionId || '',
      );

      if (!authResult.success) {
        return {
          success: false,
          transactionId: '',
          error: authResult.error || 'BNPL 승인 실패',
          metadata: {
            remainingLimit: authResult.remainingLimit,
          },
        };
      }

      // 2. HMS BNPL API 호출 시뮬레이션 (Mock 환경)
      // 실제로는 HMS BatchCMS API를 통한 승인 요청
      this.logger.log(`HMS BNPL 승인 완료: ${authResult.authorizationId}`);

      return {
        success: true,
        transactionId: authResult.authorizationId!,
        authorizationId: authResult.authorizationId!, // BNPL은 승인ID 별도 제공
        metadata: {
          provider: 'hms_bnpl',
          method: 'authorization_only',
          bnplAccountId: metadata?.bnplAccountId,
          remainingLimit: authResult.remainingLimit,
          authorizedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`HMS BNPL 승인 실패: ${errorMessage}`);

      return {
        success: false,
        transactionId: '',
        error: 'BNPL 승인 처리 중 오류가 발생했습니다',
      };
    }
  }

  /**
   * BNPL 결제 확정 (실제 HMS 출금) - PaymentGateway 인터페이스용
   */
  async capturePayment(
    authorizationIds: string[],
    batchId?: string,
  ): Promise<CaptureResult> {
    return this.batchCapture(authorizationIds, batchId);
  }

  /**
   * BNPL 배치 확정 (실제 HMS 출금) - BnplMethodGateway 인터페이스용
   */
  async batchCapture(
    authorizationIds: string[],
    batchId?: string,
  ): Promise<CaptureResult> {
    this.logger.log(`HMS BNPL 배치 출금: ${authorizationIds.length}건`);

    const captureIds: string[] = [];
    const failedIds: string[] = [];

    try {
      for (const authorizationId of authorizationIds) {
        try {
          // 1. 실제 HMS 출금 요청 (Mock 시뮬레이션)
          const hmsResult = await this.requestHmsWithdrawal({
            memberId: authorizationId, // 실제로는 bnplAccountId 필요
            amount: 0, // 실제로는 승인된 금액 필요
            paymentDate: new Date().toISOString().split('T')[0],
            invoiceId: authorizationId,
          });

          if (!hmsResult.success) {
            throw new Error(hmsResult.error || 'HMS 출금 요청 실패');
          }

          // 2. 내부 원장 업데이트는 BnplLedgerService에서 처리
          // (현재는 Mock이므로 생략)

          captureIds.push(hmsResult.transactionId!);
          this.logger.log(`HMS BNPL 출금 성공: ${authorizationId}`);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
          this.logger.error(
            `HMS BNPL 출금 실패: ${authorizationId} - ${errorMessage}`,
          );
          failedIds.push(authorizationId);
        }
      }

      return {
        success: captureIds.length > 0,
        captureIds,
        failedIds,
        metadata: {
          provider: 'hms_bnpl',
          batchId,
          totalCount: authorizationIds.length,
          successCount: captureIds.length,
          failureCount: failedIds.length,
          processedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`HMS BNPL 배치 출금 전체 실패: ${errorMessage}`);

      return {
        success: false,
        captureIds: [],
        failedIds: authorizationIds,
        error: 'BNPL 배치 처리 중 오류가 발생했습니다',
      };
    }
  }

  /**
   * BNPL 환불 처리
   *
   * ⚠️ 현재 구현 상태: 로컬 처리만 (HMS API 호출 없음)
   * - 내부 원장에만 CREDIT 트랜잭션 기록
   * - 실제 HMS BatchCMS API 환불 연동 필요
   *
   * TODO: 실제 운영 시 아래 사항들 구현 필요
   * 1. HMS BatchCMS 환불 API 호출
   * 2. 정산/원장 정책에 따른 환불 처리 로직
   * 3. 환불 승인/거부 프로세스 연동
   * 4. 배치 정산 시스템과의 연계
   */
  async refundPayment(
    transactionId: string,
    amount: number,
    reason?: string,
  ): Promise<RefundResult> {
    const amountKRW = Money.toKRWInt(amount);
    Money.validate(amountKRW);

    this.logger.log(
      `HMS BNPL 환불 (로컬 처리): ${transactionId}, 금액: ${amountKRW}KRW`,
    );

    try {
      // 1. 내부 원장 환불 처리 (BnplLedgerService)
      const refundResult = await this.bnplLedger.refundLocal(
        transactionId,
        amountKRW,
      );

      if (!refundResult.success) {
        return {
          success: false,
          refundId: '',
          refundedAmount: 0,
          error: refundResult.error || 'BNPL 환불 실패',
        };
      }

      // 2. HMS BNPL API 호출 시뮬레이션 (실제로는 HMS BatchCMS API 필요)
      this.logger.log(`HMS BNPL 환불 완료 (로컬): ${refundResult.refundId}`);
      this.logger.warn(
        '⚠️ 현재 로컬 처리만 수행됨. HMS API 연동 및 정산 로직 구현 필요',
      );

      return {
        success: true,
        refundId: refundResult.refundId!,
        refundedAmount: refundResult.refundedAmount!,
        metadata: {
          provider: 'hms_bnpl',
          method: 'local_processing_only', // 로컬 처리임을 명시
          originalTransactionId: transactionId,
          refundedAt: new Date().toISOString(),
          reason: reason || '고객 요청',
          warning: 'Local processing only - HMS API integration required',
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`HMS BNPL 환불 실패: ${errorMessage}`);

      return {
        success: false,
        refundId: '',
        refundedAmount: 0,
        error: 'BNPL 환불 처리 중 오류가 발생했습니다',
      };
    }
  }

  /**
   * BNPL 회원 등록 (BatchCMS API) - PaymentGateway 인터페이스용
   */
  async registerPaymentMethod(
    request: PaymentMethodRegistrationRequest,
  ): Promise<PaymentMethodRegistrationResult> {
    return this.registerMember(request);
  }

  /**
   * BNPL 회원 등록 (BatchCMS API) - BnplMethodGateway 인터페이스용
   */
  async registerMember(
    request: PaymentMethodRegistrationRequest,
  ): Promise<PaymentMethodRegistrationResult> {
    this.logger.log(`HMS BNPL 회원 등록: ${request.memberName}`);

    try {
      const response = await this.hmsApi.members.create({
        memberId: getTsid().toString(),
        memberName: request.memberName,
        payerName: request.memberName,
        paymentKind: 'CMS',
        paymentCompany: 'BATCHCMS',
        paymentNumber: ulid(),
        payerNumber: ulid(),
        phone: request.phone,
      });

      return {
        success: true,
        paymentMethodId: response.member.memberId,
        hmsMemberId: response.member.memberId,
        metadata: {
          provider: 'hms_bnpl',
          hmsStatus: response.member.status,
          creditLimit: request.creditLimit,
          billingCycleDay: request.billingCycleDay,
          rawResponse: response,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'HMS API 호출 실패';
      this.logger.error(`HMS BNPL 회원 등록 실패: ${errorMessage}`);

      return {
        success: false,
        paymentMethodId: '',
        error: `BNPL 회원 등록 실패: ${errorMessage}`,
      };
    }
  }

  /**
   * BNPL 전용: 출금동의서 제출 (BnplMethodGateway 인터페이스)
   */
  async submitConsent(request: {
    memberId: string;
    file: Buffer;
    filename: string;
  }): Promise<{
    success: boolean;
    agreementId?: string;
    error?: string;
    rawResponse: any;
  }> {
    this.logger.log(`HMS BNPL 출금동의서 제출: ${request.memberId}`);

    try {
      const result = await this.hmsApi.agreements.register(
        'default-cust',
        request.memberId,
        {
          file: request.file,
          filename: request.filename,
        },
      );

      return {
        success: true,
        agreementId: 'agreement-' + Date.now(),
        rawResponse: result,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'HMS API 호출 실패';
      this.logger.error(`HMS BNPL 출금동의서 제출 실패: ${errorMessage}`);

      return {
        success: false,
        error: `출금동의서 제출 실패: ${errorMessage}`,
        rawResponse: {},
      };
    }
  }

  /**
   * BNPL 전용: 회원 상태 조회 (BnplMethodGateway 인터페이스)
   */
  async getMemberStatus(memberId: string): Promise<{
    hmsStatus: string;
    registeredAt: Date | null;
    creditLimit: number;
    approvedLimit: number;
    rawResponse: any;
  }> {
    this.logger.log(`HMS BNPL 회원 상태 조회: ${memberId}`);

    try {
      const result = await this.hmsApi.members.get(memberId);

      return {
        hmsStatus: result.member.status || 'UNKNOWN',
        registeredAt: null, // HMS API 응답에서 등록일시는 별도 관리
        creditLimit: 0, // HMS에서 제공하지 않으므로 내부에서 관리
        approvedLimit: 0, // HMS에서 제공하지 않으므로 내부에서 관리
        rawResponse: result,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'HMS API 호출 실패';
      this.logger.error(`HMS BNPL 회원 상태 조회 실패: ${errorMessage}`);
      throw error;
    }
  }

  // === Private Helper Methods ===

  private async requestHmsWithdrawal(request: {
    memberId: string;
    amount: number;
    paymentDate: string;
    invoiceId: string;
  }): Promise<{
    success: boolean;
    transactionId: string;
    error?: string;
  }> {
    try {
      const result = await this.hmsApi.withdrawals.request({
        memberId: request.memberId,
        callAmount: request.amount,
        paymentDate: request.paymentDate,
        transactionId: getTsid().toString(),
      });

      return {
        success: true,
        transactionId: result.payment.transactionId,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'HMS API 호출 실패';
      return {
        success: false,
        transactionId: '',
        error: errorMessage,
      };
    }
  }
}
