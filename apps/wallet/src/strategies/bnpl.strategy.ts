import { Injectable, Logger, Inject } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';
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
import { IdempotencyService } from '../services/idempotency.service';

/**
 * @class BnplStrategy
 * @description BNPL 결제수단의 모든 비즈니스 로직(회원 등록, 결제, 배치처리 등)을 캡슐화한 클래스.
 * 여러 역할 인터페이스를 구현합니다.
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
    private readonly db: DbService<typeof schema>,
    @Inject(HMS_BNPL_PAYMENT_ADAPTER)
    private readonly bnplAdapter: BnplMethodGateway & PaymentGateway,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * @method registerMethod
   * @description BNPL 신규 회원을 HMS에 등록하고 내부 DB에 관련 정보를 생성합니다.
   * @param {any} request - 회원 등록에 필요한 데이터 DTO
   * @param {string} [idempotencyKey] - 멱등성 보장을 위한 키
   * @returns {Promise<RegistrationResult>} 등록 결과
   */
  async registerMethod(
    request: any,
    idempotencyKey?: string,
  ): Promise<RegistrationResult> {
    this.logger.log(`BNPL 회원 등록: ${request.memberName}`);

    return await this.db.db.transaction(async (tx) => {
      // 1. 멱등성 체크
      const idempotencyResult = await this.idempotency.checkOrCreate(
        tx,
        idempotencyKey,
        request,
        `/bnpl/register-member`,
      );
      if (idempotencyResult.hit)
        return idempotencyResult.response as RegistrationResult;

      try {
        // 2. HMS BNPL 어댑터로 회원 등록
        const result = await this.bnplAdapter.registerMember(request);

        if (!result.success) {
          throw new Error(result.error || 'BNPL 회원 등록에 실패했습니다');
        }

        // 3. 내부 결제수단 저장
        const [paymentMethod] = await tx
          .insert(schema.paymentMethod)
          .values({
            userId: request.userId,
            methodType: 'BNPL',
            methodName: `BNPL (${request.memberName})`,
            status: 'PENDING', // HMS 승인 대기
          })
          .returning();

        // 4. BNPL 계정 생성
        await tx.insert(schema.bnplAccount).values({
          id: result.hmsMemberId!,
          userId: request.userId,
          paymentMethodId: paymentMethod.id,
          status: 'ACTIVE',
          creditLimit: request.creditLimit || 500000,
          approvedLimit: 0,
          billingCycleDay: request.billingCycleDay || 1,
        });

        const response: RegistrationResult = {
          success: true,
          paymentMethodId: paymentMethod.id,
          hmsMemberId: result.hmsMemberId,
          metadata: {
            ...result.metadata,
            internalPaymentMethodId: paymentMethod.id,
          },
        };

        await this.idempotency.complete(tx, idempotencyKey, response, 201);

        this.logger.log(`BNPL 회원 등록 완료: ${result.hmsMemberId}`);
        return response;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`BNPL 회원 등록 실패: ${errorMessage}`);

        const failureResponse: RegistrationResult = {
          success: false,
          paymentMethodId: '',
          error: errorMessage,
        };

        await this.idempotency.complete(
          tx,
          idempotencyKey,
          failureResponse,
          400,
        );
        return failureResponse;
      }
    });
  }

  /**
   * @method processPayment
   * @description BNPL 결제를 처리합니다.
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

    return await this.db.db.transaction(async (tx): Promise<PaymentResult> => {
      const idempotencyResult = await this.idempotency.checkOrCreate(
        tx,
        idempotencyKey,
        { amount, currency, metadata },
        `/payments/process`,
      );
      if (idempotencyResult.hit)
        return idempotencyResult.response as PaymentResult;

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
        const result = await this.bnplAdapter.processPayment(
          amount,
          currency,
          paymentMetadata,
        );

        if (!result.success) {
          throw new Error(result.error || 'BNPL 결제 처리에 실패했습니다');
        }

        // 결제 이벤트 기록
        const [paymentEvent] = await tx
          .insert(schema.paymentEvents)
          .values({
            paymentSessionId: metadata.sessionId,
            paymentMethodId: metadata.paymentMethodId || '',
            status: result.authorizationId ? 'AUTHORIZED' : 'CAPTURED',
            amount: amount,
            pgTransactionId: result.transactionId,
            pgResponse: JSON.stringify({
              gateway: 'hms_bnpl',
              originalRequest: metadata,
              gatewayResponse: result.metadata,
            }),
            actor: 'USER',
            metadata: JSON.stringify({
              gateway: 'hms_bnpl',
              paymentType: 'BNPL',
              authorizationId: result.authorizationId,
            }),
          })
          .returning();

        // 세션 상태 업데이트
        const sessionStatus = result.authorizationId
          ? 'AUTHORIZED'
          : 'CAPTURED';
        await tx
          .update(schema.paymentSessions)
          .set({
            status: sessionStatus,
            updatedAt: new Date(),
          })
          .where(eq(schema.paymentSessions.id, metadata.sessionId));

        const response: PaymentResult = {
          success: true,
          transactionId: result.transactionId,
          authorizationId: result.authorizationId,
          captureId: result.captureId,
          amount,
          currency,
          status: result.authorizationId ? 'AUTHORIZED' : 'CAPTURED',
          metadata: result.metadata,
        };

        await this.idempotency.complete(tx, idempotencyKey, response, 201);
        return response;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`BNPL 결제 실패: ${errorMessage}`);

        const failureResponse: PaymentResult = {
          success: false,
          transactionId: '',
          amount,
          currency,
          status: 'FAILED',
          error: errorMessage,
        };

        await this.idempotency.complete(
          tx,
          idempotencyKey,
          failureResponse,
          400,
        );
        return failureResponse;
      }
    });
  }

  /**
   * @method refundPayment
   * @description BNPL 환불을 처리합니다.
   */
  async refundPayment(
    transactionId: string,
    amount: number,
    reason?: string,
    idempotencyKey?: string,
  ): Promise<RefundResult> {
    this.logger.log(`BNPL 환불 처리: 거래ID ${transactionId}, 금액: ${amount}`);

    return await this.db.db.transaction(async (tx): Promise<RefundResult> => {
      const idempotencyResult = await this.idempotency.checkOrCreate(
        tx,
        idempotencyKey,
        { transactionId, amount, reason },
        `/refunds/process`,
      );
      if (idempotencyResult.hit)
        return idempotencyResult.response as RefundResult;

      try {
        const result = await this.bnplAdapter.refundPayment(
          transactionId,
          amount,
          reason,
        );

        if (!result.success) {
          throw new Error(result.error || 'BNPL 환불 처리에 실패했습니다');
        }

        // 환불 이벤트 기록
        await tx.insert(schema.refundEvents).values({
          paymentEventId: transactionId,
          status: 'COMPLETED',
          amount: amount,
          reason: reason || '고객 요청',
          completedBy: 'SYSTEM', // Strategy에서 자동 처리
          completedAt: new Date(),
          metadata: JSON.stringify({
            gateway: 'hms_bnpl',
            gatewayResponse: result.metadata,
          }),
        });

        const response: RefundResult = {
          success: true,
          refundId: result.refundId,
          refundedAmount: result.refundedAmount,
          metadata: result.metadata,
        };

        await this.idempotency.complete(tx, idempotencyKey, response, 201);
        return response;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`BNPL 환불 실패: ${errorMessage}`);

        const failureResponse: RefundResult = {
          success: false,
          refundId: '',
          refundedAmount: 0,
          error: errorMessage,
        };

        await this.idempotency.complete(
          tx,
          idempotencyKey,
          failureResponse,
          400,
        );
        return failureResponse;
      }
    });
  }

  /**
   * @method batchCapture
   * @description 'AUTHORIZED' 상태의 거래들을 실제 출금 처리(CAPTURE)합니다.
   * @description **주의: 이 메서드는 스케줄러(CRON Job)에 의해 내부적으로 호출되어야 합니다.**
   * @param {string[]} authorizationIds - 출금 대상 승인 ID 목록
   * @returns {Promise<CaptureResult>} 배치 처리 결과
   */
  async batchCapture(
    authorizationIds: string[],
    batchId?: string,
    idempotencyKey?: string,
  ): Promise<CaptureResult> {
    this.logger.log(`BNPL 배치 확정: ${authorizationIds.length}건`);

    return await this.db.db.transaction(async (tx): Promise<CaptureResult> => {
      const idempotencyResult = await this.idempotency.checkOrCreate(
        tx,
        idempotencyKey,
        { authorizationIds, batchId },
        `/bnpl/batch-capture`,
      );
      if (idempotencyResult.hit)
        return idempotencyResult.response as CaptureResult;

      try {
        const result = await this.bnplAdapter.batchCapture(
          authorizationIds,
          batchId,
        );

        await this.idempotency.complete(tx, idempotencyKey, result, 201);

        this.logger.log(
          `BNPL 배치 확정 완료: ${result.captureIds.length}/${authorizationIds.length} 성공`,
        );

        return result;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`BNPL 배치 확정 실패: ${errorMessage}`);

        const failureResponse: CaptureResult = {
          success: false,
          captureIds: [],
          failedIds: authorizationIds,
          error: 'BNPL 배치 확정 처리 중 오류가 발생했습니다',
        };

        await this.idempotency.complete(
          tx,
          idempotencyKey,
          failureResponse,
          400,
        );
        return failureResponse;
      }
    });
  }

  /**
   * @method getMemberStatus
   * @description BNPL 회원 상태를 조회합니다.
   */
  async getMemberStatus(memberId: string): Promise<StatusResult> {
    this.logger.log(`BNPL 회원 상태 조회: ${memberId}`);

    try {
      const result = await this.bnplAdapter.getMemberStatus(memberId);
      return {
        success: true,
        status: this.mapHmsStatusToStandard(result.hmsStatus),
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
   * @description BNPL 계정을 활성화합니다 (스케줄러에서 호출).
   */
  async activateAccount(
    paymentMethodId: string,
    approvedLimit: number,
  ): Promise<void> {
    this.logger.log(
      `BNPL 계정 활성화: ${paymentMethodId}, 승인한도: ${approvedLimit}`,
    );

    await this.db.db.transaction(async (tx) => {
      // 1. 결제수단 활성화
      await tx
        .update(schema.paymentMethod)
        .set({
          status: 'ACTIVE',
          updatedAt: new Date(),
        })
        .where(eq(schema.paymentMethod.id, paymentMethodId));

      // 2. BNPL 계정 활성화 및 한도 설정
      await tx
        .update(schema.bnplAccount)
        .set({
          status: 'ACTIVE',
          approvedLimit,
          updatedAt: new Date(),
        })
        .where(eq(schema.bnplAccount.paymentMethodId, paymentMethodId));
    });

    this.logger.log(`BNPL 계정 활성화 완료: ${paymentMethodId}`);
  }

  /**
   * @method deactivateAccount
   * @description BNPL 계정을 비활성화합니다.
   */
  async deactivateAccount(
    paymentMethodId: string,
    reason: string,
  ): Promise<void> {
    this.logger.log(`BNPL 계정 비활성화: ${paymentMethodId}, 사유: ${reason}`);

    await this.db.db.transaction(async (tx) => {
      // 1. 결제수단 비활성화
      await tx
        .update(schema.paymentMethod)
        .set({
          status: 'INACTIVE',
          updatedAt: new Date(),
        })
        .where(eq(schema.paymentMethod.id, paymentMethodId));

      // 2. BNPL 계정 비활성화
      await tx
        .update(schema.bnplAccount)
        .set({
          status: 'SUSPENDED',
          updatedAt: new Date(),
        })
        .where(eq(schema.bnplAccount.paymentMethodId, paymentMethodId));
    });

    this.logger.log(`BNPL 계정 비활성화 완료: ${paymentMethodId}`);
  }

  /**
   * @method submitConsent
   * @description 출금동의서를 제출합니다.
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
    this.logger.log(`BNPL 출금동의서 제출: ${memberId}`);

    try {
      const result = await this.bnplAdapter.submitConsent({
        memberId,
        file,
        filename,
      });

      if (result.success) {
        this.logger.log(`출금동의서 제출 성공: ${memberId}`);
      } else {
        this.logger.error(`출금동의서 제출 실패: ${result.error}`);
      }

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`출금동의서 제출 중 오류: ${errorMessage}`);

      return {
        success: false,
        error: `출금동의서 제출 처리 중 오류: ${errorMessage}`,
        rawResponse: {},
      };
    }
  }

  /**
   * HMS 상태를 표준 상태로 매핑
   */
  private mapHmsStatusToStandard(
    hmsStatus?: string,
  ): 'ACTIVE' | 'INACTIVE' | 'PENDING' | 'FAILED' | 'INVALID' {
    if (!hmsStatus) return 'PENDING';

    switch (hmsStatus.toUpperCase()) {
      case 'REGISTERED':
      case 'APPROVED':
        return 'ACTIVE';
      case 'PENDING':
      case 'REVIEWING':
        return 'PENDING';
      case 'REJECTED':
      case 'FAILED':
        return 'FAILED';
      case 'INACTIVE':
      case 'SUSPENDED':
        return 'INACTIVE';
      default:
        return 'INVALID';
    }
  }
}
