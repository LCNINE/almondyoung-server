import { Injectable, Logger } from '@nestjs/common';
import { PaymentStrategyFactory } from '../factories/payment-strategy.factory';
import {
  PaymentResult,
  RegistrationResult,
  RefundResult,
  CaptureResult,
  StatusResult,
} from '../strategies/payment.strategy.interface';

/**
 * @class PaymentService
 * @description 결제 시스템의 통합 진입점(Facade).
 * 모든 결제 관련 요청을 받아 적절한 Strategy로 위임합니다.
 *
 * 역할:
 * - 시스템의 유일한 진입점 역할
 * - Factory를 통해 적절한 Strategy를 선택
 * - 비즈니스 로직은 Strategy에 위임
 */
@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(private readonly strategyFactory: PaymentStrategyFactory) {}

  /**
   * 결제 처리 - 모든 결제수단 통합
   */
  async processPayment(
    methodType: string,
    amount: number,
    currency: string = 'KRW',
    metadata: {
      userId: string;
      sessionId: string;
      paymentMethodId?: string;
      orderName?: string;
      bnplAccountId?: string;
      hmsMemberId?: string;
      isRecurring?: boolean;
      [key: string]: any;
    },
    idempotencyKey?: string,
  ): Promise<PaymentResult> {
    this.logger.log(
      `통합 결제 처리: ${methodType}, 금액: ${amount}${currency}, 세션: ${metadata.sessionId}`,
    );

    try {
      const strategy = this.strategyFactory.getStrategy(methodType);

      if (!('processPayment' in strategy)) {
        throw new Error(`${methodType}는 결제 처리를 지원하지 않습니다`);
      }

      return await strategy.processPayment(amount, currency, metadata);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`통합 결제 실패: ${methodType} - ${errorMessage}`);

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
   * 결제수단 등록 - 모든 등록 가능한 결제수단 통합
   */
  async registerPaymentMethod(
    methodType: string,
    request: any,
    idempotencyKey?: string,
    usage?: 'RECURRING' | 'ONE_TIME',
  ): Promise<RegistrationResult> {
    this.logger.log(
      `통합 결제수단 등록: ${methodType} (${usage || 'DEFAULT'}) - ${request.userId}`,
    );

    try {
      const strategy = this.strategyFactory.getStrategy(methodType);

      if (!('registerMethod' in strategy)) {
        throw new Error(`${methodType}는 등록을 지원하지 않습니다`);
      }

      // usage 정보를 Strategy에 전달
      const requestWithUsage = { ...request, usage };
      return await strategy.registerMethod(requestWithUsage);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `통합 결제수단 등록 실패: ${methodType} - ${errorMessage}`,
      );

      return {
        success: false,
        paymentMethodId: '',
        status: 'FAILED',
        error: errorMessage,
      };
    }
  }

  /**
   * 환불 처리 - 모든 결제수단 통합
   */
  async refundPayment(
    methodType: string,
    transactionId: string,
    amount: number,
    reason?: string,
    idempotencyKey?: string,
  ): Promise<RefundResult> {
    this.logger.log(
      `통합 환불 처리: ${methodType}, 거래ID: ${transactionId}, 금액: ${amount}`,
    );

    try {
      const strategy = this.strategyFactory.getStrategy(methodType);

      if (!('refundPayment' in strategy)) {
        throw new Error(`${methodType}는 환불 처리를 지원하지 않습니다`);
      }

      return await strategy.refundPayment(transactionId, amount, reason);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`통합 환불 실패: ${methodType} - ${errorMessage}`);

      return {
        success: false,
        refundId: '',
        refundedAmount: 0,
        status: 'FAILED',
        error: errorMessage,
      };
    }
  }

  /**
   * 배치 처리 - 배치 처리 지원 결제수단만
   */
  async batchCapture(
    methodType: string,
    authorizationIds: string[],
    batchId?: string,
    idempotencyKey?: string,
  ): Promise<CaptureResult> {
    this.logger.log(
      `통합 배치 확정: ${methodType}, ${authorizationIds.length}건`,
    );

    try {
      const strategy =
        this.strategyFactory.getBatchProcessingStrategy(methodType);
      return await strategy.batchCapture(authorizationIds, batchId);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`통합 배치 확정 실패: ${methodType} - ${errorMessage}`);

      return {
        success: false,
        captureId: '',
        capturedAmount: 0,
        status: 'FAILED',
        failedIds: authorizationIds,
        error: errorMessage,
      };
    }
  }

  /**
   * 회원 상태 조회 - 상태 조회 지원 결제수단만
   */
  async getMemberStatus(
    methodType: string,
    memberId: string,
  ): Promise<StatusResult> {
    this.logger.log(`통합 회원 상태 조회: ${methodType}, 회원ID: ${memberId}`);

    try {
      const strategy = this.strategyFactory.getStrategy(methodType);

      if (!('getMemberStatus' in strategy)) {
        throw new Error(`${methodType}는 상태 조회를 지원하지 않습니다`);
      }

      return await strategy.getMemberStatus(memberId);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `통합 회원 상태 조회 실패: ${methodType} - ${errorMessage}`,
      );

      return {
        success: false,
        status: 'FAILED',
        error: errorMessage,
      };
    }
  }

  /**
   * 계정 활성화 - 계정 관리 지원 결제수단만
   */
  async activateAccount(
    methodType: string,
    paymentMethodId: string,
    approvedLimit: number,
  ): Promise<void> {
    this.logger.log(
      `통합 계정 활성화: ${methodType}, ${paymentMethodId}, 한도: ${approvedLimit}`,
    );

    try {
      const strategy = this.strategyFactory.getStrategy(methodType);

      if (!('activateAccount' in strategy)) {
        throw new Error(`${methodType}는 계정 관리를 지원하지 않습니다`);
      }

      await strategy.activateAccount(paymentMethodId, approvedLimit);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `통합 계정 활성화 실패: ${methodType} - ${errorMessage}`,
      );
      throw new Error(errorMessage);
    }
  }

  /**
   * 계정 비활성화 - 계정 관리 지원 결제수단만
   */
  async deactivateAccount(
    methodType: string,
    paymentMethodId: string,
    reason: string,
  ): Promise<void> {
    this.logger.log(
      `통합 계정 비활성화: ${methodType}, ${paymentMethodId}, 사유: ${reason}`,
    );

    try {
      const strategy = this.strategyFactory.getStrategy(methodType);

      if (!('deactivateAccount' in strategy)) {
        throw new Error(`${methodType}는 계정 관리를 지원하지 않습니다`);
      }

      await strategy.deactivateAccount(paymentMethodId, reason);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `통합 계정 비활성화 실패: ${methodType} - ${errorMessage}`,
      );
      throw new Error(errorMessage);
    }
  }

  /**
   * 출금동의서 제출 - BNPL 전용
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
    this.logger.log(`통합 출금동의서 제출: ${memberId}`);

    try {
      const strategy = this.strategyFactory.getStrategy('BNPL');

      if (!('submitConsent' in strategy)) {
        throw new Error('BNPL은 출금동의서 제출을 지원하지 않습니다');
      }

      const result = await strategy.submitConsent(memberId, file, filename);
      return {
        ...result,
        rawResponse: result.metadata,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`통합 출금동의서 제출 실패: ${errorMessage}`);

      return {
        success: false,
        error: errorMessage,
        rawResponse: {},
      };
    }
  }
}
