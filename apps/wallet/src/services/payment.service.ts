import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { eq } from 'drizzle-orm';
import { PaymentStrategyFactory } from '../factories/payment-strategy.factory';
import { IdempotencyService } from './idempotency.service';
import { generateUUIDv7 } from '../shared/utils/id-generator';
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

  constructor(
    private readonly db: DbService<typeof schema>,
    private readonly strategyFactory: PaymentStrategyFactory,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * 결제 처리 - 모든 결제수단 통합 (오케스트레이션)
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

    return await this.db.db.transaction(async (tx) => {
      const idempotencyResult = await this.idempotency.checkOrCreate(
        tx,
        idempotencyKey,
        { methodType, amount, currency, metadata },
        `/payments/process`,
      );
      if (idempotencyResult.hit)
        return idempotencyResult.response as PaymentResult;

      try {
        const strategy = this.strategyFactory.getStrategy(methodType);

        if (!('processPayment' in strategy)) {
          throw new Error(`${methodType}는 결제 처리를 지원하지 않습니다`);
        }

        // Strategy를 통한 순수 결제 처리
        const result = await strategy.processPayment(
          amount,
          currency,
          metadata,
        );

        if (!result.success) {
          throw new Error(result.error || '결제 처리에 실패했습니다');
        }

        // 결제 이벤트 기록
        await tx.insert(schema.paymentEvents).values({
          paymentSessionId: metadata.sessionId,
          paymentMethodId: metadata.paymentMethodId || '',
          status: 'CAPTURED',
          amount: amount,
          pgTransactionId: result.transactionId,
          pgResponse: JSON.stringify({
            gateway: methodType === 'CARD' ? 'hms_card' : 'unknown',
            originalRequest: metadata,
            gatewayResponse: result.metadata,
          }),
          actor: 'USER',
          metadata: JSON.stringify({
            gateway: methodType === 'CARD' ? 'hms_card' : 'unknown',
            paymentType: methodType,
            captureId: result.captureId,
          }),
        });

        // 세션 상태 업데이트
        await tx
          .update(schema.paymentSessions)
          .set({
            status: 'CAPTURED',
            updatedAt: new Date(),
          })
          .where(eq(schema.paymentSessions.id, metadata.sessionId));

        const response: PaymentResult = {
          success: true,
          transactionId: result.transactionId,
          captureId: result.captureId,
          amount,
          currency,
          status: 'CAPTURED',
          metadata: result.metadata,
        };

        await this.idempotency.complete(tx, idempotencyKey, response);
        return response;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`통합 결제 실패: ${methodType} - ${errorMessage}`);

        const failureResponse: PaymentResult = {
          success: false,
          transactionId: '',
          amount,
          currency,
          status: 'FAILED',
          error: errorMessage,
        };

        await this.idempotency.complete(tx, idempotencyKey, failureResponse);
        return failureResponse;
      }
    });
  }

  /**
   * 결제수단 등록 - 모든 등록 가능한 결제수단 통합 (오케스트레이션)
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

    return await this.db.db.transaction(async (tx) => {
      const idempotencyResult = await this.idempotency.checkOrCreate(
        tx,
        idempotencyKey,
        { methodType, request, usage },
        `/payment-methods/register`,
      );
      if (idempotencyResult.hit)
        return idempotencyResult.response as RegistrationResult;

      try {
        const strategy = this.strategyFactory.getStrategy(methodType);

        if (!('registerMethod' in strategy)) {
          throw new Error(`${methodType}는 등록을 지원하지 않습니다`);
        }

        // usage 정보를 Strategy에 전달
        const requestWithUsage = { ...request, usage };
        const result = await strategy.registerMethod(requestWithUsage);

        if (!result.success) {
          throw new Error(result.error || '결제수단 등록에 실패했습니다');
        }

        // 내부 결제수단 저장 (Strategy에서 외부 API 호출 성공 후)
        const [paymentMethod] = await tx
          .insert(schema.paymentMethod)
          .values({
            userId: request.userId,
            methodType: methodType as
              | 'CARD'
              | 'BANK_ACCOUNT'
              | 'BNPL'
              | 'REWARD_POINT',
            methodName:
              request.methodName ||
              `${methodType} (${request.memberName || request.userId})`,
            status: usage === 'ONE_TIME' ? 'ACTIVE' : 'PENDING', // 일회성은 즉시 활성화
          })
          .returning();

        // 카드 등록의 경우 추가 정보 저장
        if (
          methodType === 'CARD' &&
          usage === 'RECURRING' &&
          result.hmsMemberId
        ) {
          await tx.insert(schema.cardMethod).values({
            id: paymentMethod.id,
            methodType: 'CARD',
            pgToken: result.hmsMemberId,
            billingKey: result.hmsMemberId,
            maskedCardNumber: request.maskedCardNumber || '****-****-****-****',
            lastFourDigits: request.paymentNumber?.slice(-4) || '0000',
            cardBrand: 'HMS_CARD',
            cardType: 'CREDIT',
            issuerName: 'HMS',
          });
        }

        const response: RegistrationResult = {
          success: true,
          paymentMethodId: paymentMethod.id,
          hmsMemberId: result.hmsMemberId,
          status: paymentMethod.status as 'PENDING' | 'ACTIVE' | 'FAILED',
          metadata: {
            ...result.metadata,
            internalPaymentMethodId: paymentMethod.id,
          },
        };

        await this.idempotency.complete(tx, idempotencyKey, response);
        return response;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(
          `통합 결제수단 등록 실패: ${methodType} - ${errorMessage}`,
        );

        const failureResponse: RegistrationResult = {
          success: false,
          paymentMethodId: '',
          status: 'FAILED',
          error: errorMessage,
        };

        await this.idempotency.complete(tx, idempotencyKey, failureResponse);
        return failureResponse;
      }
    });
  }

  /**
   * 환불 처리 - 모든 결제수단 통합 (오케스트레이션)
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

    return await this.db.db.transaction(async (tx) => {
      const idempotencyResult = await this.idempotency.checkOrCreate(
        tx,
        idempotencyKey,
        { methodType, transactionId, amount, reason },
        `/refunds/process`,
      );
      if (idempotencyResult.hit)
        return idempotencyResult.response as RefundResult;

      try {
        const strategy = this.strategyFactory.getStrategy(methodType);

        if (!('refundPayment' in strategy)) {
          throw new Error(`${methodType}는 환불 처리를 지원하지 않습니다`);
        }

        // Strategy를 통한 순수 환불 처리
        const result = await strategy.refundPayment(
          transactionId,
          amount,
          reason,
        );

        if (!result.success) {
          throw new Error(result.error || '환불 처리에 실패했습니다');
        }

        // 환불 이벤트 기록
        await tx.insert(schema.refundEvents).values({
          paymentEventId: transactionId,
          status: 'COMPLETED',
          amount: amount,
          reason: reason || '고객 요청',
          completedBy: 'SYSTEM',
          completedAt: new Date(),
          metadata: JSON.stringify({
            gateway: methodType === 'CARD' ? 'hms_card' : 'unknown',
            gatewayResponse: result.metadata,
          }),
        });

        const response: RefundResult = {
          success: true,
          refundId: result.refundId,
          refundedAmount: result.refundedAmount,
          metadata: result.metadata,
        };

        await this.idempotency.complete(tx, idempotencyKey, response);
        return response;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`통합 환불 실패: ${methodType} - ${errorMessage}`);

        const failureResponse: RefundResult = {
          success: false,
          refundId: '',
          refundedAmount: 0,
          error: errorMessage,
        };

        await this.idempotency.complete(tx, idempotencyKey, failureResponse);
        return failureResponse;
      }
    });
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
