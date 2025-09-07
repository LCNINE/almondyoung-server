import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import { PaymentSessionService } from './payment-session.service';

/**
 * 중앙화된 결제 서비스 (가이드 문서 준수)
 *
 * 역할:
 * 1. 결제수단 소유/상태 검증
 * 2. 외부 PG사 승인/매입 요청 (어댑터 직접 호출)
 * 3. 결제 이벤트 저장 (PaymentEvents 테이블)
 *
 * Strategy/Factory 패턴 제거 → 어댑터 직접 호출로 단순화
 */
@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly db: DbService<typeof schema>,
    private readonly paymentSessionService: PaymentSessionService,
    // 어댑터들을 직접 주입
    // private readonly hmsCardAdapter: HmsCardAdapter,
    // private readonly hmsBnplAdapter: HmsBnplAdapter,
    // private readonly tossAdapter: TossAdapter,
    // private readonly pointAdapter: PointAdapter,
  ) {}

  /**
   * 결제 처리 (문서 가이드라인 준수 - 세션 기반)
   *
   * Flow:
   * 1. 세션 없으면 자동 생성
   * 2. 결제수단 검증
   * 3. 어댑터 호출 (PG사 승인/매입)
   * 4. PaymentEvents 저장 (sessionId 필수)
   * 5. PaymentSessionEvents 저장 (상태 변경 로그)
   * 6. PaymentSessions 상태 업데이트
   */
  async processPayment(
    request: {
      userId: string;
      paymentMethodId: string;
      amount: number;
      currency?: string;
      sessionId?: string;
      metadata?: any;
      pricingSnapshot?: any;
      actor: 'USER' | 'SCHEDULER' | 'ADMIN' | 'SYSTEM';
    },
    idempotencyKey?: string,
  ): Promise<{
    paymentEventId: string;
    sessionId: string;
    status: 'AUTHORIZED' | 'CAPTURED' | 'FAILED';
    amount: number;
    createdAt: Date;
  }> {
    this.logger.log(
      `결제 처리 시작: ${request.paymentMethodId}, ${request.amount}원`,
    );

    return await this.db.db.transaction(async (tx) => {
      // 1. 세션 없으면 자동 생성
      let sessionId = request.sessionId;
      if (!sessionId) {
        this.logger.log('세션이 없어 자동 생성합니다');
        const sessionResponse = await this.paymentSessionService.createSession({
          userId: request.userId,
          amount: request.amount,
          currency: request.currency || 'KRW',
          metadata: request.metadata,
        });
        sessionId = sessionResponse.sessionId;
      }

      // 2. 결제수단 검증
      const paymentMethod = await this.validatePaymentMethod(
        tx,
        request.paymentMethodId,
        request.userId,
      );

      // 3. 어댑터 호출 (결제수단 타입에 따라)
      const pgResult = await this.callPaymentAdapter(paymentMethod.methodType, {
        paymentMethodId: request.paymentMethodId,
        amount: request.amount,
        currency: request.currency || 'KRW',
        metadata: request.metadata,
      });

      // 4. PaymentEvents 저장 (sessionId 필수)
      const eventId = ulid();
      await tx.insert(schema.paymentEvents).values({
        id: eventId,
        sessionId: sessionId, // 이제 필수
        methodId: request.paymentMethodId,
        amount: request.amount,
        status: pgResult.status as any,
        actor: request.actor as any,
        errorMessage: pgResult.error || null,
        eventContext: JSON.stringify({
          pg: {
            gateway: this.getGatewayName(paymentMethod.methodType),
            approvalNumber: pgResult.approvalNumber,
            paymentDate: pgResult.paymentDate,
            actualAmount: pgResult.actualAmount,
            fee: pgResult.fee,
            transactionId: pgResult.transactionId,
          },
          business: {
            paymentPurpose: request.metadata?.paymentPurpose || 'PURCHASE',
            isSubscriptionPayment:
              request.metadata?.isSubscriptionPayment || false,
            source: request.metadata?.source || 'api',
            hmsMemberId: request.metadata?.hmsMemberId,
            billingCycle: request.metadata?.billingCycle,
            scheduledAt: request.metadata?.scheduledAt,
          },
          pricing: {
            originalAmount: request.pricingSnapshot?.originalAmount,
            discountAmount: request.pricingSnapshot?.discountAmount,
            finalAmount: request.pricingSnapshot?.finalAmount || request.amount,
            couponId: request.pricingSnapshot?.couponId,
            discountRate: request.pricingSnapshot?.discountRate,
          },
        }) as any,
      });

      // 5. PaymentSessionEvents 저장 (상태 변경 로그)
      const eventType =
        pgResult.status === 'CAPTURED'
          ? 'PAYMENT_CAPTURED'
          : pgResult.status === 'AUTHORIZED'
            ? 'PAYMENT_AUTHORIZED'
            : pgResult.status === 'FAILED'
              ? 'PAYMENT_FAILED'
              : 'PAYMENT_FAILED';

      await tx.insert(schema.paymentSessionEvents).values({
        paymentSessionId: sessionId,
        eventType: eventType as any,
        eventData: JSON.stringify({
          paymentEventId: eventId,
          pgResult: pgResult,
        }),
      });

      // 6. PaymentSessions 상태 업데이트
      await tx
        .update(schema.paymentSessions)
        .set({
          status: pgResult.status as any,
          updatedAt: new Date(),
          ...(pgResult.status === 'AUTHORIZED' && { authorizedAt: new Date() }),
          ...(pgResult.status === 'CAPTURED' && { capturedAt: new Date() }),
        })
        .where(eq(schema.paymentSessions.id, sessionId));

      this.logger.log(
        `결제 처리 완료: ${eventId}, 세션: ${sessionId}, 상태: ${pgResult.status}`,
      );

      return {
        paymentEventId: eventId,
        sessionId: sessionId,
        status: pgResult.status,
        amount: request.amount,
        createdAt: new Date(),
      };
    });
  }

  /**
   * BNPL 배치 처리
   */
  async processBnplBatch(request: {
    batchId: string;
    actor: 'SCHEDULER';
  }): Promise<{
    processedCount: number;
    totalAmount: number;
    processedAt: Date;
  }> {
    this.logger.log(`BNPL 배치 처리: ${request.batchId}`);

    // TODO: BNPL 배치 처리 로직 구현
    throw new Error('BNPL 배치 처리 기능은 아직 구현되지 않았습니다');
  }

  /**
   * 결제 상태 조회
   */
  async getPaymentStatus(paymentEventId: string): Promise<{
    id: string;
    status: string;
    amount: number;
    pgTransactionId: string;
    createdAt: Date;
    metadata: any;
    pricingSnapshot: any;
  }> {
    this.logger.log(`결제 상태 조회: ${paymentEventId}`);

    const result = await this.db.db
      .select()
      .from(schema.paymentEvents)
      .where(eq(schema.paymentEvents.id, paymentEventId))
      .limit(1);

    if (result.length === 0) {
      throw new Error(`결제 이벤트를 찾을 수 없습니다: ${paymentEventId}`);
    }

    const event = result[0];
    return {
      id: event.id,
      status: event.status,
      amount: Number(event.amount),
      createdAt: event.createdAt,
      eventContext: event.eventContext
        ? typeof event.eventContext === 'string'
          ? JSON.parse(event.eventContext)
          : event.eventContext
        : null,
    } as any;
  }

  /**
   * 결제수단 검증 (private 헬퍼)
   */
  private async validatePaymentMethod(
    tx: any,
    paymentMethodId: string,
    userId: string,
  ) {
    const result = await tx
      .select()
      .from(schema.paymentMethod)
      .where(eq(schema.paymentMethod.id, paymentMethodId))
      .limit(1);

    if (result.length === 0) {
      throw new Error(`결제수단을 찾을 수 없습니다: ${paymentMethodId}`);
    }

    const paymentMethod = result[0];

    if (paymentMethod.userId !== userId) {
      throw new Error('결제수단 소유자가 일치하지 않습니다');
    }

    if (paymentMethod.status !== 'ACTIVE') {
      throw new Error(
        `결제수단이 비활성화 상태입니다: ${paymentMethod.status}`,
      );
    }

    return paymentMethod;
  }

  /**
   * 어댑터 호출 (private 헬퍼)
   */
  private async callPaymentAdapter(
    methodType: string,
    request: {
      paymentMethodId: string;
      amount: number;
      currency: string;
      metadata?: any;
    },
  ): Promise<{
    status: 'AUTHORIZED' | 'CAPTURED' | 'FAILED';
    transactionId: string;
    approvalNumber?: string;
    paymentDate?: string;
    actualAmount?: number;
    fee?: number;
    statusCode?: string;
    message?: string;
    error?: string;
    processedAt?: string;
  }> {
    this.logger.log(`어댑터 호출: ${methodType}, ${request.amount}원`);

    // TODO: 실제 어댑터 호출 로직 구현
    // 현재는 Mock 응답 반환
    switch (methodType) {
      case 'CARD':
        return {
          status: 'CAPTURED',
          transactionId: `card_${ulid()}`,
          approvalNumber: 'APPR123456',
          paymentDate: new Date().toISOString(),
          actualAmount: request.amount,
          fee: Math.floor(request.amount * 0.03),
          statusCode: '0000',
          message: '정상처리',
          processedAt: new Date().toISOString(),
        };
      case 'BNPL':
        return {
          status: 'AUTHORIZED',
          transactionId: `bnpl_${ulid()}`,
          actualAmount: request.amount,
          statusCode: '0000',
          message: '승인완료',
          processedAt: new Date().toISOString(),
        };
      case 'REWARD_POINT':
        return {
          status: 'CAPTURED',
          transactionId: `point_${ulid()}`,
          actualAmount: request.amount,
          statusCode: '0000',
          message: '포인트 차감 완료',
          processedAt: new Date().toISOString(),
        };
      default:
        throw new Error(`지원하지 않는 결제수단 타입: ${methodType}`);
    }
  }

  /**
   * 게이트웨이 이름 반환 (private 헬퍼)
   */
  private getGatewayName(methodType: string): string {
    switch (methodType) {
      case 'CARD':
        return 'hms_card';
      case 'BNPL':
        return 'hms_bnpl';
      case 'EASY_PAY':
        return 'toss';
      case 'REWARD_POINT':
        return 'internal_point';
      default:
        return 'unknown';
    }
  }
}
