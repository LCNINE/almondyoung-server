import { Injectable, Logger, Inject } from '@nestjs/common';
import {
  PaymentProcessingStrategy,
  RegistrableStrategy,
  BatchProcessingStrategy,
  StatusQueryStrategy,
  AccountManagementStrategy,
  ConsentSubmissionStrategy,
  PaymentResult,
  RegistrationResult,
  RefundResult,
  CaptureResult,
  StatusResult,
} from './payment.strategy.interface';
import { BnplMethodGateway } from '../interfaces/payment-method-gateways.interface';
import { PaymentGateway } from '../interfaces/payment-gateway.interface';
import { HMS_BNPL_PAYMENT_ADAPTER } from '../shared/tokens/gateway.tokens';

/**
 * @class BnplStrategy
 * @description BNPL 결제수단 전략 (순수 어댑터 호출만 담당)
 * - DB/트랜잭션/멱등성/이벤트 관리는 PaymentService에서 처리
 * - 여러 역할 인터페이스를 구현합니다.
 */
@Injectable()
export class BnplStrategy
  implements
    PaymentProcessingStrategy,
    RegistrableStrategy,
    BatchProcessingStrategy,
    StatusQueryStrategy,
    AccountManagementStrategy,
    ConsentSubmissionStrategy
{
  private readonly logger = new Logger(BnplStrategy.name);

  constructor(
    @Inject(HMS_BNPL_PAYMENT_ADAPTER)
    private readonly bnplAdapter: BnplMethodGateway & PaymentGateway,
  ) {}

  /**
   * @method registerMethod
   * @description BNPL 회원을 HMS에 등록합니다 (순수 어댑터 호출)
   * @param {any} request - 회원 등록에 필요한 데이터 DTO
   * @param {string} [idempotencyKey] - 멱등성 키 (PaymentService에서 처리)
   * @returns {Promise<RegistrationResult>} 등록 결과
   */
  async registerMethod(
    request: any,
    idempotencyKey?: string,
  ): Promise<RegistrationResult> {
    this.logger.log(`BNPL 회원 등록: ${request.memberName}`);

    try {
      // HMS BNPL 어댑터로 회원 등록 (순수 외부 API 호출)
      const result = await this.bnplAdapter.registerMember(request);

      if (!result.success) {
        throw new Error(result.error || 'BNPL 회원 등록에 실패했습니다');
      }

      this.logger.log(`BNPL 회원 등록 완료: ${result.hmsMemberId}`);
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`BNPL 회원 등록 실패: ${errorMessage}`);

      return {
        success: false,
        paymentMethodId: '',
        error: errorMessage,
      };
    }
  }

  /**
   * @method processPayment
   * @description BNPL 결제를 처리합니다 (순수 어댑터 호출)
   */
  async processPayment(
    amount: number,
    currency: string,
    metadata: Record<string, any>,
    idempotencyKey?: string,
  ): Promise<PaymentResult> {
    this.logger.log(
      `BNPL 결제 처리: 금액 ${amount}${currency}, 세션: ${metadata.sessionId}`,
    );

    try {
      const paymentMetadata = {
        userId: metadata.userId,
        sessionId: metadata.sessionId,
        paymentMethodId: metadata.paymentMethodId || '',
        orderName: metadata.orderName,
        hmsMemberId: metadata.hmsMemberId,
        bnplAccountId: metadata.bnplAccountId,
        isRecurring: metadata.isRecurring,
      };

      // BNPL 어댑터를 통한 결제 처리 (순수 비즈니스 로직)
      const result = await this.bnplAdapter.processPayment(
        amount,
        currency,
        paymentMetadata,
      );

      if (!result.success) {
        throw new Error(result.error || 'BNPL 결제 처리에 실패했습니다');
      }

      return {
        success: true,
        transactionId: result.transactionId,
        authorizationId: result.authorizationId,
        captureId: result.captureId,
        amount,
        currency,
        status: result.authorizationId ? 'AUTHORIZED' : 'CAPTURED',
        metadata: result.metadata,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`BNPL 결제 실패: ${errorMessage}`);

      return {
        success: false,
        transactionId: '',
        amount,
        currency,
        status: 'FAILED',
        error: errorMessage,
      };
    }
  }

  /**
   * @method refundPayment
   * @description BNPL 환불을 처리합니다 (순수 어댑터 호출)
   */
  async refundPayment(
    transactionId: string,
    amount: number,
    reason?: string,
    idempotencyKey?: string,
  ): Promise<RefundResult> {
    this.logger.log(`BNPL 환불 처리: 거래ID ${transactionId}, 금액: ${amount}`);

    try {
      const result = await this.bnplAdapter.refundPayment(
        transactionId,
        amount,
        reason,
      );

      if (!result.success) {
        throw new Error(result.error || 'BNPL 환불 처리에 실패했습니다');
      }

      return {
        success: true,
        refundId: result.refundId,
        refundedAmount: result.refundedAmount,
        metadata: result.metadata,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`BNPL 환불 실패: ${errorMessage}`);

      return {
        success: false,
        refundId: '',
        refundedAmount: 0,
        error: errorMessage,
      };
    }
  }

  /**
   * @method batchCapture
   * @description 'AUTHORIZED' 상태의 거래들을 실제 출금 처리(CAPTURE)합니다 (순수 어댑터 호출)
   * @description **주의: 이 메서드는 스케줄러(CRON Job)에 의해 내부적으로 호출되어야 합니다.**
   */
  async batchCapture(
    authorizationIds: string[],
    batchId?: string,
    idempotencyKey?: string,
  ): Promise<CaptureResult> {
    this.logger.log(`BNPL 배치 확정: ${authorizationIds.length}건`);

    try {
      const result = await this.bnplAdapter.batchCapture(
        authorizationIds,
        batchId,
      );

      this.logger.log(
        `BNPL 배치 확정 완료: ${result.captureIds.length}/${authorizationIds.length} 성공`,
      );

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`BNPL 배치 확정 실패: ${errorMessage}`);

      return {
        success: false,
        captureIds: [],
        failedIds: authorizationIds,
        error: 'BNPL 배치 확정 처리 중 오류가 발생했습니다',
      };
    }
  }

  /**
   * @method getMemberStatus
   * @description BNPL 회원 상태를 조회합니다 (순수 어댑터 호출)
   */
  async getMemberStatus(memberId: string): Promise<StatusResult> {
    this.logger.log(`BNPL 회원 상태 조회: ${memberId}`);

    try {
      const result = await this.bnplAdapter.getMemberStatus(memberId);
      return {
        success: true,
        status: this.mapHmsStatusToStandard(result.hmsStatus) as
          | 'PENDING'
          | 'ACTIVE'
          | 'FAILED'
          | 'INACTIVE'
          | 'INVALID',
        hmsStatus: result.hmsStatus,
        metadata: result,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`BNPL 회원 상태 조회 실패: ${errorMessage}`);

      return {
        success: false,
        status: 'FAILED',
        error: errorMessage,
      };
    }
  }

  /**
   * @method activateAccount
   * @description BNPL 계정을 활성화합니다 (PaymentMethodService로 이관 예정)
   * TODO: 이 메서드는 PaymentMethodService로 이동해야 합니다.
   */
  async activateAccount(
    paymentMethodId: string,
    approvedLimit: number,
  ): Promise<void> {
    this.logger.log(
      `BNPL 계정 활성화: ${paymentMethodId}, 승인한도: ${approvedLimit}`,
    );

    // TODO: PaymentMethodService로 이동
    this.logger.warn(
      'activateAccount는 PaymentMethodService로 이동해야 합니다.',
    );
  }

  /**
   * @method deactivateAccount
   * @description BNPL 계정을 비활성화합니다 (PaymentMethodService로 이관 예정)
   * TODO: 이 메서드는 PaymentMethodService로 이동해야 합니다.
   */
  async deactivateAccount(paymentMethodId: string): Promise<void> {
    this.logger.log(`BNPL 계정 비활성화: ${paymentMethodId}`);

    // TODO: PaymentMethodService로 이동
    this.logger.warn(
      'deactivateAccount는 PaymentMethodService로 이동해야 합니다.',
    );
  }

  /**
   * @method submitConsent
   * @description BNPL 동의서를 제출합니다 (순수 어댑터 호출)
   */
  async submitConsent(
    memberId: string,
    file: Buffer,
    filename: string,
  ): Promise<{
    success: boolean;
    agreementId?: string;
    error?: string;
    rawResponse: any;
  }> {
    this.logger.log(`BNPL 동의서 제출: ${memberId}`);

    try {
      const result = await this.bnplAdapter.submitConsent({
        memberId,
        file,
        filename,
      });

      if (!result.success) {
        throw new Error(result.error || 'BNPL 동의서 제출에 실패했습니다');
      }

      this.logger.log(`BNPL 동의서 제출 완료: ${result.agreementId}`);
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`BNPL 동의서 제출 실패: ${errorMessage}`);

      return {
        success: false,
        error: errorMessage,
        rawResponse: {},
      };
    }
  }

  /**
   * HMS 상태를 표준 상태로 매핑
   */
  private mapHmsStatusToStandard(hmsStatus?: string): string {
    switch (hmsStatus) {
      case 'ACTIVE':
        return 'ACTIVE';
      case 'PENDING':
        return 'PENDING';
      case 'SUSPENDED':
        return 'INACTIVE';
      case 'CLOSED':
        return 'CLOSED';
      default:
        return 'UNKNOWN';
    }
  }
}
