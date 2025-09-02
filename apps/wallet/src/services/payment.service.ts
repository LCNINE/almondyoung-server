import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { eq } from 'drizzle-orm';
import { createHash } from 'crypto';
import { PaymentAdapter } from '../ports/payment-adapter.port';
import { TossCardAdapter } from '../adapters/toss-card.adapter';
import { PointAdapter } from '../adapters/point.adapter';
import { BnplAdapter } from '../adapters/bnpl.adapter';
import { IdempotencyService } from './Idempotency.service';
import { ApprovePaymentDto } from '../shared/dtos/payments/approve-payment.dto';
import {
  ApprovePaymentResponse,
  AuthorizePaymentResponse,
  CapturePaymentResponse,
} from '../shared/dtos/payments/payment-response.dto';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private readonly adapters: Map<string, PaymentAdapter> = new Map();
  constructor(
    private readonly db: DbService<typeof schema>,
    private readonly idempotency: IdempotencyService,
    private readonly tossCardAdapter: TossCardAdapter,
    private readonly pointAdapter: PointAdapter,
    private readonly bnplAdapter: BnplAdapter,
  ) {
    // 결제수단별 어댑터 등록
    this.adapters.set('CARD', this.tossCardAdapter);
    this.adapters.set('REWARD_POINT', this.pointAdapter);
    this.adapters.set('BNPL', this.bnplAdapter);

    this.logger.log('PaymentService 초기화 완료 - 어댑터 등록됨');
  }

  /**
   * 결제 승인 - 메인 오케스트레이션 로직
   * @param dto 결제 승인 요청 데이터
   * @param idemKey 멱등성 키 (선택사항)
   */
  async approvePayment(
    dto: ApprovePaymentDto,
    idemKey?: string,
  ): Promise<ApprovePaymentResponse> {
    this.logger.log(
      `결제 승인 시작: sessionId=${dto.sessionId}, methodId=${dto.paymentMethodId}`,
    );

    const requestHash = createHash('sha256')
      .update(JSON.stringify({ ...dto, route: 'POST /payments/approve' }))
      .digest('hex');

    return this.db.db.transaction(async (tx) => {
      // 1. 멱등성 처리
      if (idemKey) {
        const idem =
          await this.idempotency.checkOrCreate<ApprovePaymentResponse>(
            tx,
            idemKey,
            dto,
            '/payments/approve',
          );
        if (idem.hit) {
          this.logger.log(`멱등성 히트: ${idemKey}`);
          return idem.response!;
        }
      }

      // 2. 결제 세션 조회
      const [session] = await tx
        .select()
        .from(schema.paymentSessions)
        .where(eq(schema.paymentSessions.id, dto.sessionId))
        .limit(1);

      if (!session) {
        throw new NotFoundException('결제 세션을 찾을 수 없습니다');
      }

      if (session.status !== 'PENDING') {
        throw new Error(`이미 처리된 결제 세션입니다: ${session.status}`);
      }

      // 3. 결제수단 조회
      const [paymentMethod] = await tx
        .select()
        .from(schema.paymentMethod)
        .where(eq(schema.paymentMethod.id, dto.paymentMethodId))
        .limit(1);

      if (!paymentMethod) {
        throw new NotFoundException('결제수단을 찾을 수 없습니다');
      }

      if (paymentMethod.status !== 'ACTIVE') {
        throw new Error('비활성화된 결제수단입니다');
      }

      // 4. 결제수단별 어댑터로 결제 처리
      const adapter = this.adapters.get(paymentMethod.methodType);
      if (!adapter) {
        throw new Error(
          `지원하지 않는 결제수단입니다: ${paymentMethod.methodType}`,
        );
      }

      const authorizeResult = await adapter.authorize({
        paymentMethodId: dto.paymentMethodId,
        amount: session.amount,
        currency: session.currency,
        orderName: dto.metadata?.orderName as string | undefined,
        metadata: {
          ...dto.metadata,
          paymentSessionId: session.id,
          userId: session.userId,
        },
      });

      // 5. 결제 이벤트 저장
      const [paymentEvent] = await tx
        .insert(schema.paymentEvents)
        .values({
          paymentSessionId: session.id,
          paymentMethodId: dto.paymentMethodId,
          amount: session.amount,
          status: authorizeResult.success ? 'AUTHORIZED' : 'FAILED',
          pgTransactionId: authorizeResult.pgTransactionId,
          pgResponse: JSON.stringify(authorizeResult.metadata || {}),
          actor: 'USER',
          errorMessage: authorizeResult.error,
          metadata: JSON.stringify(authorizeResult.metadata || {}),
        })
        .returning();

      // 6. 결제 세션 상태 업데이트
      const newSessionStatus = authorizeResult.success
        ? 'AUTHORIZED'
        : 'FAILED';
      await tx
        .update(schema.paymentSessions)
        .set({
          status: newSessionStatus,
          authorizedAt: authorizeResult.success ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(schema.paymentSessions.id, session.id));

      // 7. 결제 세션 이벤트 저장
      await tx.insert(schema.paymentSessionEvents).values({
        paymentSessionId: session.id,
        eventType: authorizeResult.success
          ? 'PAYMENT_AUTHORIZED'
          : 'PAYMENT_FAILED',
        eventData: JSON.stringify({
          paymentMethodId: dto.paymentMethodId,
          amount: session.amount,
          error: authorizeResult.error,
          metadata: authorizeResult.metadata,
        }),
      });

      const response: ApprovePaymentResponse = {
        success: authorizeResult.success,
        paymentId: paymentEvent.id,
        sessionId: session.id,
        amount: session.amount,
        currency: session.currency,
        status: newSessionStatus,
        paymentEvents: [
          {
            paymentMethodId: dto.paymentMethodId,
            methodType: paymentMethod.methodType as
              | 'CARD'
              | 'BNPL'
              | 'REWARD_POINT',
            amount: session.amount,
            status: authorizeResult.success ? 'AUTHORIZED' : 'FAILED',
            pgTransactionId: authorizeResult.pgTransactionId,
            error: authorizeResult.error,
            metadata: authorizeResult.metadata,
          },
        ],
        metadata: {
          requestHash,
          processedAt: new Date().toISOString(),
        },
        error: authorizeResult.error,
      };

      this.logger.log(
        `결제 승인 완료: ${authorizeResult.success ? '성공' : '실패'} - ${paymentEvent.id}`,
      );

      return response;
    });
  }

  /**
   * 결제 승인만 별도 처리 (DB 저장용)
   * @param paymentEventId 결제 이벤트 ID
   */
  async authorizePayment(
    paymentEventId: string,
  ): Promise<AuthorizePaymentResponse> {
    this.logger.log(`결제 승인 처리: ${paymentEventId}`);

    return this.db.db.transaction(async (tx) => {
      // 결제 이벤트 조회
      const [paymentEvent] = await tx
        .select()
        .from(schema.paymentEvents)
        .where(eq(schema.paymentEvents.id, paymentEventId))
        .limit(1);

      if (!paymentEvent) {
        throw new NotFoundException('결제 이벤트를 찾을 수 없습니다');
      }

      if (paymentEvent.status === 'AUTHORIZED') {
        return {
          success: true,
          paymentId: paymentEvent.id,
          amount: paymentEvent.amount,
          status: 'AUTHORIZED',
          authorizedAt: paymentEvent.createdAt.toISOString(),
        };
      }

      // 승인되지 않은 경우 에러
      return {
        success: false,
        paymentId: paymentEvent.id,
        amount: paymentEvent.amount,
        status: 'FAILED',
        authorizedAt: new Date().toISOString(),
        error: paymentEvent.errorMessage || '결제 승인 실패',
      };
    });
  }

  /**
   * 결제 캡처 처리 (실제 결제 확정)
   * @param paymentEventId 결제 이벤트 ID
   */
  async capturePayment(
    paymentEventId: string,
  ): Promise<CapturePaymentResponse> {
    this.logger.log(`결제 캡처 처리: ${paymentEventId}`);

    return this.db.db.transaction(async (tx) => {
      // 결제 이벤트 조회
      const [paymentEvent] = await tx
        .select()
        .from(schema.paymentEvents)
        .where(eq(schema.paymentEvents.id, paymentEventId))
        .limit(1);

      if (!paymentEvent) {
        throw new NotFoundException('결제 이벤트를 찾을 수 없습니다');
      }

      if (paymentEvent.status !== 'AUTHORIZED') {
        throw new Error('승인되지 않은 결제는 캡처할 수 없습니다');
      }

      // 결제수단 조회
      const [paymentMethod] = await tx
        .select()
        .from(schema.paymentMethod)
        .where(eq(schema.paymentMethod.id, paymentEvent.paymentMethodId))
        .limit(1);

      if (!paymentMethod) {
        throw new NotFoundException('결제수단을 찾을 수 없습니다');
      }

      // 어댑터로 캡처 처리
      const adapter = this.adapters.get(paymentMethod.methodType);
      if (!adapter) {
        throw new Error(
          `지원하지 않는 결제수단입니다: ${paymentMethod.methodType}`,
        );
      }

      const captureResult = await adapter.capture({
        pgTransactionId: paymentEvent.pgTransactionId!,
        amount: paymentEvent.amount,
        metadata: {
          paymentEventId: paymentEvent.id,
        },
      });

      if (captureResult.success) {
        // 결제 이벤트 상태 업데이트
        await tx
          .update(schema.paymentEvents)
          .set({
            status: 'CAPTURED',
            pgTransactionId: captureResult.pgTransactionId,
            pgResponse: JSON.stringify(captureResult.metadata || {}),
            updatedAt: new Date(),
          })
          .where(eq(schema.paymentEvents.id, paymentEvent.id));

        // 결제 세션 상태 업데이트
        await tx
          .update(schema.paymentSessions)
          .set({
            status: 'CAPTURED',
            capturedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(schema.paymentSessions.id, paymentEvent.paymentSessionId));
      }

      return {
        success: captureResult.success,
        paymentId: paymentEvent.id,
        amount: paymentEvent.amount,
        status: captureResult.success ? 'CAPTURED' : 'FAILED',
        capturedAt: new Date().toISOString(),
        error: captureResult.error,
        metadata: captureResult.metadata,
      };
    });
  }
}
