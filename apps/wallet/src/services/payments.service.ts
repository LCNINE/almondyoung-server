/**
 * 결제 승인 서비스
 * - 멱등성: 같은 키 + 같은 payload => 동일 응답 반환
 * - 세션 상태 전이: PENDING -> AUTHORIZED
 * - 이벤트 적재: payment_events(AUTHORIZED), payment_session_events(PAYMENT_AUTHORIZED)
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { ApprovePaymentDto } from '../shared/dtos/payments/approve-payment.dto';
import { CapturePaymentDto } from '../shared/dtos/payments/capture-payment.dto';
import { PaymentSessionsService } from './payment-sessions.service';
import { IdempotencyService } from './Idempotency.service';

// 공용 응답 타입을 먼저 정의해두면 재사용하기 좋아요
export interface ApprovePaymentResponse {
  paymentId: string;
  sessionId: string;
  status:
    | 'PENDING'
    | 'AUTHORIZED'
    | 'CAPTURED'
    | 'FAILED'
    | 'CANCELLED'
    | 'REFUNDED';
  pgTransactionId: string;
  authorizedAt: Date | null;
  metadata: Record<string, any>;
}

export interface CapturePaymentResponse {
  paymentId: string;
  sessionId: string;
  status: 'CAPTURED';
  pgTransactionId: string;
  capturedAt: Date;
  metadata: Record<string, any>;
}
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  constructor(
    private readonly dbService: DbService<typeof schema>,

    private readonly paymentSessions: PaymentSessionsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async approve(dto: ApprovePaymentDto, idemKey?: string) {
    if (!dto.sessionId || !dto.paymentMethodId) {
      throw new BadRequestException('sessionId & paymentMethodId required');
    }

    const requestHash = createHash('sha256')
      .update(JSON.stringify({ ...dto, route: 'POST /payments/approve' }))
      .digest('hex');

    return this.dbService.db.transaction(
      async (tx): Promise<ApprovePaymentResponse> => {
        // 1) 멱등성 처리
        if (idemKey) {
          const found = await tx
            .select()
            .from(schema.idempotencyKeys)
            .where(eq(schema.idempotencyKeys.id, idemKey))
            .limit(1);

          if (found.length) {
            if (found[0].requestHash !== requestHash) {
              throw new ConflictException(
                'Idempotency-Key reused with different payload',
              );
            }
            if (found[0].status === 'COMPLETED' && found[0].responseBody) {
              this.logger.log(`Idempotency hit: ${idemKey}`);
              return JSON.parse(
                found[0].responseBody,
              ) as ApprovePaymentResponse;
            }
          } else {
            await tx.insert(schema.idempotencyKeys).values({
              id: idemKey,
              userId: 'unknown', // 세션 조회 후 갱신 X (MVP 간소화)
              requestPath: '/payments/approve',
              requestHash,
              status: 'PROCESSING',
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            });
          }
        }

        // 2) 세션 조회
        const [session] = await tx
          .select()
          .from(schema.paymentSessions)
          .where(eq(schema.paymentSessions.id, dto.sessionId))
          .limit(1);

        if (!session) throw new NotFoundException('payment session not found');

        // 3) 현재 상태 검사
        if (
          session.status === 'AUTHORIZED' ||
          session.status === 'CAPTURED' ||
          session.status === 'REFUNDED'
        ) {
          // 같은 페이로드로 재호출이면 위 멱등성 케시가 잡아줄 것.
          // 여기로 왔다는 건 키 없거나 다른 키이므로 충돌 처리.
          throw new ConflictException(`session already ${session.status}`);
        }
        if (session.status !== 'PENDING') {
          throw new ConflictException(
            `cannot approve from status ${session.status}`,
          );
        }

        // 4) PG 승인 (MVP: Stub) 및 전이
        const pgTransactionId = dto.paymentKey ?? `tx_${randomUUID()}`;

        // payment_events 추가
        const [paymentEvent] = await tx
          .insert(schema.paymentEvents)
          .values({
            paymentSessionId: session.id,
            paymentMethodId: dto.paymentMethodId,
            amount: session.amount,
            status: 'AUTHORIZED',
            pgTransactionId,
            pgResponse: dto.paymentKey ? null : JSON.stringify({ stub: true }),
            actor: 'USER',
            metadata: dto.metadata ? JSON.stringify(dto.metadata) : null,
          })
          .returning();

        // 세션 상태 업데이트
        const now = new Date();
        const [updated] = await tx
          .update(schema.paymentSessions)
          .set({ status: 'AUTHORIZED', authorizedAt: now, updatedAt: now })
          .where(eq(schema.paymentSessions.id, session.id))
          .returning();

        // 세션 이벤트
        await tx.insert(schema.paymentSessionEvents).values({
          paymentSessionId: session.id,
          eventType: 'PAYMENT_AUTHORIZED',
          eventData: dto.metadata ? JSON.stringify(dto.metadata) : null,
        });

        const response = {
          paymentId: paymentEvent.id,
          sessionId: session.id,
          status: updated.status,
          pgTransactionId,
          authorizedAt: updated.authorizedAt,
          metadata: dto.metadata ?? {},
        };

        if (idemKey) {
          await tx
            .update(schema.idempotencyKeys)
            .set({
              status: 'COMPLETED',
              responseCode: 200,
              responseBody: JSON.stringify(response),
            })
            .where(eq(schema.idempotencyKeys.id, idemKey));
        }

        this.logger.log(
          `Approved: session=${session.id} tx=${pgTransactionId}`,
        );
        return response;
      },
    );
  }

  async capture(
    paymentEventId: string,
    dto: CapturePaymentDto,
    idemKey?: string,
  ): Promise<CapturePaymentResponse> {
    return this.dbService.db.transaction<CapturePaymentResponse>(async (tx) => {
      // 1) 멱등성
      const idem = await this.idempotency.checkOrCreate<CapturePaymentResponse>(
        tx,
        idemKey,
        dto,
        `/payments/${paymentEventId}/capture`,
      );
      if (idem.hit) return idem.response!;

      // 2) 캡처 대상 AUTHORIZED 이벤트 조회
      const [authEvent] = await tx
        .select()
        .from(schema.paymentEvents)
        .where(eq(schema.paymentEvents.id, paymentEventId))
        .limit(1);

      if (!authEvent) {
        throw new NotFoundException('authorized payment event not found');
      }
      if (authEvent.status !== 'AUTHORIZED') {
        throw new ConflictException(
          `cannot capture a ${authEvent.status} event (only AUTHORIZED)`,
        );
      }

      // 3) 세션 상태 확인 (AUTHORIZED 여야 함)
      const session = await this.paymentSessions.ensureStatus(
        authEvent.paymentSessionId,
        'AUTHORIZED',
      );

      // 4) PG Stub
      const pgTransactionId = `tx_${randomUUID()}`;
      const now = new Date();

      // 5) CAPTURED 이벤트 추가 (❗ paymentMethodId는 AUTHORIZED 이벤트에서 가져옴)
      const [capturedEvent] = await tx
        .insert(schema.paymentEvents)
        .values({
          paymentSessionId: session.id,
          paymentMethodId: authEvent.paymentMethodId, // ← 여기!
          amount: dto.amount ?? session.amount,
          status: 'CAPTURED',
          pgTransactionId,
          actor: 'USER',
          metadata: dto.metadata ? JSON.stringify(dto.metadata) : null,
        })
        .returning();

      // 6) 세션 CAPTURED 전이
      const [updated] = await tx
        .update(schema.paymentSessions)
        .set({ status: 'CAPTURED', capturedAt: now, updatedAt: now })
        .where(eq(schema.paymentSessions.id, session.id))
        .returning();

      // 7) 세션 이벤트 기록
      await tx.insert(schema.paymentSessionEvents).values({
        paymentSessionId: session.id,
        eventType: 'PAYMENT_CAPTURED',
        eventData: dto.metadata ? JSON.stringify(dto.metadata) : null,
      });

      // 8) 응답
      const response: CapturePaymentResponse = {
        paymentId: capturedEvent.id,
        sessionId: session.id,
        status: 'CAPTURED',
        pgTransactionId,
        capturedAt: updated.capturedAt!,
        metadata: dto.metadata ?? {},
      };

      // 9) 멱등성 완료
      await this.idempotency.complete(tx, idemKey, response, 200);

      return response;
    });
  }
}
