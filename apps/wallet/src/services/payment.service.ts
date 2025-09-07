import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';

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
    // 어댑터들을 직접 주입
    // private readonly hmsCardAdapter: HmsCardAdapter,
    // private readonly hmsBnplAdapter: HmsBnplAdapter,
    // private readonly tossAdapter: TossAdapter,
    // private readonly pointAdapter: PointAdapter,
  ) {}

  /**
   * 결제 처리 (가이드 문서의 핵심 메서드)
   *
   * Flow:
   * 1. 결제수단 검증
   * 2. 어댑터 호출 (PG사 승인/매입)
   * 3. PaymentEvents 저장
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
    pgTransactionId: string;
    status: 'AUTHORIZED' | 'CAPTURED' | 'FAILED';
    amount: number;
    createdAt: Date;
  }> {
    this.logger.log(
      `결제 처리 시작: ${request.paymentMethodId}, ${request.amount}원`,
    );

    return await this.db.db.transaction(async (tx) => {
      // 1. 결제수단 검증
      const paymentMethod = await this.validatePaymentMethod(
        tx,
        request.paymentMethodId,
        request.userId,
      );

      // 2. 어댑터 호출 (결제수단 타입에 따라)
      const pgResult = await this.callPaymentAdapter(paymentMethod.methodType, {
        paymentMethodId: request.paymentMethodId,
        amount: request.amount,
        currency: request.currency || 'KRW',
        metadata: request.metadata,
      });

      // 3. PaymentEvents 저장 (가이드 스키마 준수)
      await tx.insert(schema.paymentEvents).values({
        paymentSessionId: request.sessionId || null,
        paymentMethodId: request.paymentMethodId,
        amount: request.amount,
        status: pgResult.status as any,
        pgTransactionId: pgResult.transactionId,
        pgResponse: JSON.stringify({
          gateway: this.getGatewayName(paymentMethod.methodType),
          approvalNumber: pgResult.approvalNumber,
          paymentDate: pgResult.paymentDate,
          actualAmount: pgResult.actualAmount,
          fee: pgResult.fee,
          statusCode: pgResult.statusCode,
          message: pgResult.message,
        }),
        actor: request.actor as any,
        createdAt: new Date(),
        errorMessage: pgResult.error || null,
        metadata: JSON.stringify({
          paymentPurpose: request.metadata?.paymentPurpose || 'PURCHASE',
          isSubscriptionPayment:
            request.metadata?.isSubscriptionPayment || false,
          requestedAt: new Date().toISOString(),
          transactionProcessedAt: pgResult.processedAt,
          correlationId: request.metadata?.correlationId,
          source: request.metadata?.source || 'api',
          hmsMemberId: request.metadata?.hmsMemberId,
        }),
        pricingSnapshot: request.pricingSnapshot
          ? JSON.stringify({
              originalAmount: request.pricingSnapshot.originalAmount,
              discountAmount: request.pricingSnapshot.discountAmount,
              finalAmount: request.amount,
              couponId: request.pricingSnapshot.couponId,
              discountRate: request.pricingSnapshot.discountRate,
            })
          : null,
      } as any);

      // PaymentEvents 저장 후 ID 조회
      const insertedEvents = await tx
        .select({ id: schema.paymentEvents.id })
        .from(schema.paymentEvents)
        .where(eq(schema.paymentEvents.pgTransactionId, pgResult.transactionId))
        .limit(1);

      const paymentEventId = insertedEvents[0]?.id || ulid();

      this.logger.log(
        `결제 처리 완료: ${paymentEventId}, 상태: ${pgResult.status}`,
      );

      return {
        paymentEventId,
        pgTransactionId: pgResult.transactionId,
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
      pgTransactionId: event.pgTransactionId || '',
      createdAt: event.createdAt,
      metadata: event.metadata ? JSON.parse(event.metadata) : {},
      pricingSnapshot: event.pricingSnapshot
        ? typeof event.pricingSnapshot === 'string'
          ? JSON.parse(event.pricingSnapshot)
          : event.pricingSnapshot
        : null,
    };
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
