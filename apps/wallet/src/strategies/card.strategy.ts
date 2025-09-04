import { Injectable, Logger, Inject } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { eq } from 'drizzle-orm';
import { generateUUIDv7 } from '../shared/utils/id-generator';
import {
  PaymentProcessingStrategy,
  RegistrableStrategy,
  StatusQueryStrategy,
  PaymentResult,
  RegistrationResult,
  RefundResult,
  StatusResult,
} from './payment.strategy.interface';
import { CardMethodGateway } from '../interfaces/payment-method-gateways.interface';
import { PaymentGateway } from '../interfaces/payment-gateway.interface';
import { HMS_CARD_PAYMENT_ADAPTER } from '../shared/tokens/gateway.tokens';
import { IdempotencyService } from '../services/idempotency.service';

/**
 * @class CardStrategy
 * @description 카드 결제수단의 모든 비즈니스 로직(HMS CMS 정기결제 등록, 결제 등)을 캡슐화한 클래스.
 */
@Injectable()
export class CardStrategy
  implements PaymentProcessingStrategy, RegistrableStrategy, StatusQueryStrategy
{
  private readonly logger = new Logger(CardStrategy.name);

  constructor(
    private readonly db: DbService<typeof schema>,
    @Inject(HMS_CARD_PAYMENT_ADAPTER)
    private readonly cardAdapter: CardMethodGateway & PaymentGateway,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * @method registerMethod
   * @description HMS CMS 정기결제 회원을 등록하고 내부 DB에 관련 정보를 생성합니다.
   */
  async registerMethod(
    request: any,
    idempotencyKey?: string,
  ): Promise<RegistrationResult> {
    const { usage = 'RECURRING', ...requestData } = request;
    this.logger.log(
      `카드 등록 (${usage}): ${requestData.memberName || requestData.userId}`,
    );

    // usage에 따른 분기 처리
    if (usage === 'RECURRING') {
      return this.registerRecurringCard(requestData, idempotencyKey);
    } else if (usage === 'ONE_TIME') {
      return this.registerOneTimeCard(requestData, idempotencyKey);
    } else {
      throw new Error(`지원하지 않는 카드 사용 용도: ${usage}`);
    }
  }

  /**
   * 정기결제용 카드 등록 (빌링키 발급)
   */
  private async registerRecurringCard(
    request: any,
    idempotencyKey?: string,
  ): Promise<RegistrationResult> {
    this.logger.log(`HMS CMS 정기결제 회원 등록: ${request.memberName}`);

    return await this.db.db.transaction(async (tx) => {
      const idempotencyResult = await this.idempotency.checkOrCreate(
        tx,
        idempotencyKey,
        request,
        `/card/register-member`,
      );
      if (idempotencyResult.hit)
        return idempotencyResult.response as RegistrationResult;

      try {
        // HMS CMS 정기결제 회원 등록 (CardMethodGateway 인터페이스 사용)
        const result = await this.cardAdapter.registerRecurringMember(request);

        if (!result.success) {
          throw new Error(result.error || 'HMS CMS 회원 등록 실패');
        }

        // 내부 결제수단 저장
        const [paymentMethod] = await tx
          .insert(schema.paymentMethod)
          .values({
            userId: request.userId,
            methodType: 'CARD',
            methodName: `카드 (${request.memberName})`,
            status: 'PENDING', // HMS 승인 대기
          })
          .returning();

        // HMS CMS 카드 정보 저장
        await tx.insert(schema.batchCmsMethod).values({
          id: paymentMethod.id,
          paymentMethodId: paymentMethod.id,
          hmsMemberId: result.hmsMemberId!,
          creditLimit: 1000000, // 기본 100만원
          approvedLimit: 0, // 승인 전에는 0
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

        this.logger.log(`HMS CMS 회원 등록 완료: ${result.hmsMemberId}`);
        return response;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`HMS CMS 회원 등록 실패: ${errorMessage}`);

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
   * 일회성 카드 등록 (단순 정보 저장)
   */
  private async registerOneTimeCard(
    request: any,
    idempotencyKey?: string,
  ): Promise<RegistrationResult> {
    this.logger.log(`일회성 카드 등록: ${request.userId}`);

    return await this.db.db.transaction(async (tx) => {
      const idempotencyResult = await this.idempotency.checkOrCreate(
        tx,
        idempotencyKey,
        request,
        `/card/register-one-time`,
      );
      if (idempotencyResult.hit)
        return idempotencyResult.response as RegistrationResult;

      try {
        // 일회성 카드는 단순 정보 저장만 수행 (외부 검증 없음)
        if (!request.cardInfo?.cardNumber) {
          throw new Error('카드 번호가 필요합니다');
        }

        // 내부 DB에 결제수단 정보만 저장 (빌링키 없음)
        const [paymentMethod] = await tx
          .insert(schema.paymentMethod)
          .values({
            id: `pm_${generateUUIDv7()}`,
            userId: request.userId,
            methodType: 'CARD',
            methodName: request.methodName || '등록 카드',
            status: 'ACTIVE', // 일회성은 즉시 활성화
            isDefault: false,
          })
          .returning();

        const response: RegistrationResult = {
          success: true,
          paymentMethodId: paymentMethod.id,
          status: 'ACTIVE',
        };

        await this.idempotency.complete(tx, idempotencyKey, response, 201);

        this.logger.log(`일회성 카드 등록 완료: ${paymentMethod.id}`);
        return response;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`일회성 카드 등록 실패: ${errorMessage}`);

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
   * @description 카드 결제를 처리합니다 (Toss 게이트웨이 사용).
   */
  async processPayment(
    amount: number,
    currency: string,
    metadata: Record<string, any>,
    idempotencyKey?: string,
  ): Promise<PaymentResult> {
    this.logger.log(
      `카드 결제 처리: 금액 ${amount}${currency}, 세션: ${metadata.sessionId}`,
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
        // HMS CMS 정기결제 또는 Toss 일반결제 처리
        // HMS Member ID가 있으면 HMS CMS 정기결제, 없으면 Toss 일반결제
        const paymentMetadata = {
          userId: metadata.userId,
          sessionId: metadata.sessionId,
          paymentMethodId: metadata.paymentMethodId || '',
          orderName: metadata.orderName,
          hmsMemberId: metadata.hmsMemberId,
          bnplAccountId: metadata.bnplAccountId,
          isRecurring: metadata.isRecurring || !!metadata.hmsMemberId, // HMS Member ID가 있으면 정기결제
        };

        // PaymentGateway 인터페이스를 통한 결제 처리
        const result = await this.cardAdapter.processPayment(
          amount,
          currency,
          paymentMetadata,
        );

        if (!result.success) {
          throw new Error(result.error || '카드 결제 처리에 실패했습니다');
        }

        // 결제 이벤트 기록
        const [paymentEvent] = await tx
          .insert(schema.paymentEvents)
          .values({
            paymentSessionId: metadata.sessionId,
            paymentMethodId: metadata.paymentMethodId || '',
            status: 'CAPTURED', // 카드는 즉시 확정
            amount: amount,
            pgTransactionId: result.transactionId,
            pgResponse: JSON.stringify({
              gateway: 'toss',
              originalRequest: metadata,
              gatewayResponse: result.metadata,
            }),
            actor: 'USER',
            metadata: JSON.stringify({
              gateway: 'toss',
              paymentType: 'CARD',
              captureId: result.captureId,
            }),
          })
          .returning();

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

        await this.idempotency.complete(tx, idempotencyKey, response, 201);
        return response;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`카드 결제 실패: ${errorMessage}`);

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
   * @description 카드 환불을 처리합니다.
   */
  async refundPayment(
    transactionId: string,
    amount: number,
    reason?: string,
    idempotencyKey?: string,
  ): Promise<RefundResult> {
    this.logger.log(`카드 환불 처리: 거래ID ${transactionId}, 금액: ${amount}`);

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
        const result = await this.cardAdapter.refundPayment(
          transactionId,
          amount,
          reason,
        );

        if (!result.success) {
          throw new Error(result.error || '카드 환불 처리에 실패했습니다');
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
            gateway: 'toss',
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
        this.logger.error(`카드 환불 실패: ${errorMessage}`);

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
   * @method getMemberStatus
   * @description HMS CMS 회원 상태를 조회합니다.
   */
  async getMemberStatus(memberId: string): Promise<StatusResult> {
    this.logger.log(`HMS CMS 회원 상태 조회: ${memberId}`);

    try {
      // HMS API를 통해 회원 정보 조회 (현재는 간단한 검증만 구현)
      const validationResult =
        await this.cardAdapter.validateHmsMember(memberId);
      const isValid = validationResult.isValid;

      return {
        success: true,
        status: isValid ? 'ACTIVE' : 'INVALID',
        metadata: {
          memberId,
          creditLimit: 1000000,
          lastPaymentDate: null,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`HMS CMS 회원 상태 조회 실패: ${errorMessage}`);

      return {
        success: false,
        status: 'FAILED',
        error: errorMessage,
      };
    }
  }
}
