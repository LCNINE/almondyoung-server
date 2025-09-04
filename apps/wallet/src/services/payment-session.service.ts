/**
 * 결제 세션 서비스 (A안: Service → Drizzle 직접 호출)
 * - 아이템포턴시 키 지원 (24h TTL)
 * - payment_sessions: PENDING insert
 * - payment_session_events: SESSION_CREATED insert
 * - 동일 Idempotency-Key + 동일 요청이면 캐시 응답
 * - 동일 Idempotency-Key + 다른 요청이면 409
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import * as crypto from 'node:crypto';
import { CreatePaymentSessionDto } from '../shared/dtos/create-payment-session.dto';
import * as schema from '../shared/database/schema';
import { DbService } from '@app/db';
export interface CreatePaymentSessionResponse {
  sessionId: string;
  status:
    | 'PENDING'
    | 'AUTHORIZED'
    | 'CAPTURED'
    | 'FAILED'
    | 'CANCELLED'
    | 'REFUNDED';
  checkout: { url: string };
  metadata: Record<string, any>;
}

@Injectable()
export class PaymentSessionService {
  private readonly logger = new Logger(PaymentSessionService.name);
  constructor(private readonly dbService: DbService<typeof schema>) {}
  // createSessionV2 제거 - 불필요한 중복이었음
  // 기존 createSession이 더 우수함 (멱등성, 이벤트 적재, 트랜잭션 안전성)

  /**
   * 결제 세션 조회
   */
  async getSession(sessionId: string) {
    const [session] = await this.dbService.db
      .select()
      .from(schema.paymentSessions)
      .where(eq(schema.paymentSessions.id, sessionId))
      .limit(1);

    if (!session) {
      throw new NotFoundException('결제 세션을 찾을 수 없습니다');
    }

    return session;
  }

  /**
   * 결제 세션 생성 (기존)
   * @param dto CreatePaymentSessionDto
   * @param idemKey Idempotency-Key 헤더
   * @returns { sessionId, status, checkout, metadata }
   */
  async createSession(
    dto: CreatePaymentSessionDto,
    idemKey?: string,
  ): Promise<CreatePaymentSessionResponse> {
    if (dto.amount <= 0) {
      throw new BadRequestException('amount must be positive');
    }

    const requestHash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ ...dto, route: 'POST /payment-sessions' }))
      .digest('hex');

    return await this.dbService.db.transaction<CreatePaymentSessionResponse>(
      async (tx) => {
        // 1) 아이템포턴시 선조회/검증
        if (idemKey) {
          const hit = await tx
            .select()
            .from(schema.idempotencyKeys)
            .where(eq(schema.idempotencyKeys.id, idemKey))
            .limit(1);

          if (hit.length) {
            // 기존 키가 있는데 payload가 다르면 409
            if (hit[0].requestHash !== requestHash) {
              throw new ConflictException(
                'Idempotency-Key reused with different payload',
              );
            }
            // 기존 COMPLETED 캐시 응답 반환
            if (hit[0].status === 'COMPLETED' && hit[0].responseBody) {
              this.logger.log(`Idempotency hit: ${idemKey}`);
              return JSON.parse(
                hit[0].responseBody,
              ) as CreatePaymentSessionResponse;
            }
            // 기존 PROCESSING이면 계속 진행 (동일 트랜잭션 내에서 완료 처리)
          } else {
            // 없으면 PROCESSING 저장
            await tx.insert(schema.idempotencyKeys).values({
              id: idemKey,
              userId: dto.userId,
              requestPath: '/payment-sessions',
              requestHash,
              status: 'PROCESSING',
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            });
          }
        }

        // 2) (선택) 결제수단 존재/상태 확인 — MVP는 생략 가능
        // const pm = await tx.select().from(schema.paymentMethod)
        //   .where(eq(schema.paymentMethod.id, dto.paymentMethodId)).limit(1);
        // if (!pm[0]) throw new NotFoundException('paymentMethod not found');

        // 3) 세션 생성
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30분
        const [session] = await tx
          .insert(schema.paymentSessions)
          .values({
            userId: dto.userId,
            amount: dto.amount,
            currency: dto.currency,
            status: 'PENDING',
            metadata: dto.metadata ? JSON.stringify(dto.metadata) : null,
            expiresAt,
          })
          .returning();

        // 4) 이벤트 적재
        await tx.insert(schema.paymentSessionEvents).values({
          paymentSessionId: session.id,
          eventType: 'SESSION_CREATED',
          eventData: dto.requiresManualCapture
            ? JSON.stringify({ requiresManualCapture: true })
            : null,
        });

        // payment-sessions.service.ts (패치된 부분만)
        // 5) 응답 구성
        const baseUrl = process.env.WALLET_URL || 'http://localhost:5000';
        const returnUrl = dto.metadata?.returnUrl ?? '';
        const checkoutUrl = `${baseUrl}/wallet/checkout/${session.id}${
          returnUrl ? `?returnUrl=${encodeURIComponent(returnUrl)}` : ''
        }`;

        const response: CreatePaymentSessionResponse = {
          sessionId: session.id,
          status: session.status,
          checkout: { url: checkoutUrl },
          metadata: dto.metadata ?? {},
        };

        // 6) 아이템포턴시 완료 저장
        if (idemKey) {
          await tx
            .update(schema.idempotencyKeys)
            .set({
              status: 'COMPLETED',
              responseCode: 201,
              responseBody: JSON.stringify(response),
            })
            .where(eq(schema.idempotencyKeys.id, idemKey));
        }

        this.logger.log(`Session created: ${session.id}`);
        return response;
      },
    );
  }

  async ensureStatus(
    sessionId: string,
    expected:
      | (typeof schema.paymentSessions.$inferSelect)['status']
      | (typeof schema.paymentSessions.$inferSelect)['status'][],
  ) {
    const [session] = await this.dbService.db
      .select()
      .from(schema.paymentSessions)
      .where(eq(schema.paymentSessions.id, sessionId))
      .limit(1);

    if (!session) throw new NotFoundException('payment session not found');

    const expectedArr = Array.isArray(expected) ? expected : [expected];
    if (!expectedArr.includes(session.status)) {
      throw new ConflictException(
        `Invalid session status: expected ${expectedArr.join(', ')}, got ${session.status}`,
      );
    }

    return session;
  }
}
