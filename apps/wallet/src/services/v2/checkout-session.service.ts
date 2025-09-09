// services/v2/checkout-session.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import { DbService } from '@app/db';
import * as schema from '../../shared/database/schema';
import {
  CheckoutSessionCreateDto,
  CheckoutSessionResponseDto,
  CheckoutSessionCallbackDto,
} from '../../shared/dtos/checkout-session.dto';
import { PaymentIntentService } from './payment-intent.service';

/**
 * CheckoutSession v2 Service
 *
 * 책임:
 * - 웹 리다이렉트 결제창 UX 세션 관리
 * - PG사 콜백 처리 및 Intent/Attempt 자동 연동
 * - 세션 상태 관리 (PENDING → COMPLETED/CANCELLED/EXPIRED)
 * - PG사별 리다이렉트 URL 생성
 */
@Injectable()
export class CheckoutSessionService {
  private readonly logger = new Logger(CheckoutSessionService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly paymentIntentService: PaymentIntentService,
  ) {}

  /**
   * CheckoutSession 생성
   */
  async createSession(
    dto: CheckoutSessionCreateDto,
  ): Promise<CheckoutSessionResponseDto> {
    this.logger.log(
      `CheckoutSession 생성 시작: intentId=${dto.intentId}, provider=${dto.provider}`,
    );

    return await this.dbService.db.transaction(async (tx) => {
      // 1. Intent 존재 확인
      const intents = await tx
        .select()
        .from(schema.paymentIntents)
        .where(eq(schema.paymentIntents.id, dto.intentId))
        .limit(1);

      if (intents.length === 0) {
        throw new Error(`Intent not found: ${dto.intentId}`);
      }

      const intent = intents[0];

      // 2. Intent 상태 검증
      if (intent.status !== 'PENDING') {
        throw new Error(`Intent already processed: ${intent.status}`);
      }

      if (new Date() > intent.expiresAt) {
        throw new Error('Intent expired');
      }

      // 3. Provider 허용 여부 확인
      const allowedProviders = intent.allowedProviders
        ? JSON.parse(intent.allowedProviders)
        : [];

      if (!allowedProviders.includes(dto.provider)) {
        throw new Error(`Provider ${dto.provider} not allowed for this intent`);
      }

      // 4. CheckoutSession 생성
      const sessionId = `cs_${ulid()}`;
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15분

      await tx.insert(schema.checkoutSessions).values({
        id: sessionId,
        intentId: dto.intentId,
        provider: dto.provider as any,
        redirectUrl: dto.redirectUrl,
        cancelUrl: dto.cancelUrl,
        status: 'PENDING',
        expiresAt,
        metadata: dto.metadata ? JSON.stringify(dto.metadata) : null,
      });

      // 5. PG사별 결제창 URL 생성
      const checkoutUrl = this.generateCheckoutUrl(
        sessionId,
        dto.provider,
        intent.amount,
        dto.metadata,
      );

      const response: CheckoutSessionResponseDto = {
        sessionId,
        intentId: dto.intentId,
        provider: dto.provider,
        status: 'PENDING',
        checkoutUrl,
        expiresAt: expiresAt.toISOString(),
        createdAt: new Date().toISOString(),
        metadata: dto.metadata,
      };

      this.logger.log(`CheckoutSession 생성 완료: ${sessionId}`);
      return response;
    });
  }

  /**
   * CheckoutSession 조회
   */
  async getSession(sessionId: string): Promise<CheckoutSessionResponseDto> {
    const sessions = await this.dbService.db
      .select()
      .from(schema.checkoutSessions)
      .where(eq(schema.checkoutSessions.id, sessionId))
      .limit(1);

    if (sessions.length === 0) {
      throw new Error(`CheckoutSession not found: ${sessionId}`);
    }

    const session = sessions[0];

    return {
      sessionId: session.id,
      intentId: session.intentId,
      provider: session.provider,
      status: session.status,
      checkoutUrl: this.generateCheckoutUrl(
        sessionId,
        session.provider,
        0, // 금액은 Intent에서 가져와야 하지만 일단 0
        session.metadata ? JSON.parse(session.metadata) : undefined,
      ),
      expiresAt: session.expiresAt.toISOString(),
      createdAt: session.createdAt.toISOString(),
      completedAt: session.completedAt?.toISOString(),
      metadata: session.metadata ? JSON.parse(session.metadata) : undefined,
    };
  }

  /**
   * PG사 콜백 처리
   */
  async handleCallback(
    sessionId: string,
    dto: CheckoutSessionCallbackDto,
  ): Promise<CheckoutSessionResponseDto> {
    this.logger.log(
      `PG사 콜백 처리 시작: sessionId=${sessionId}, status=${dto.status}`,
    );

    return await this.dbService.db.transaction(async (tx) => {
      // 1. CheckoutSession 조회
      const sessions = await tx
        .select()
        .from(schema.checkoutSessions)
        .where(eq(schema.checkoutSessions.id, sessionId))
        .limit(1);

      if (sessions.length === 0) {
        throw new Error(`CheckoutSession not found: ${sessionId}`);
      }

      const session = sessions[0];

      // 2. 세션 상태 검증
      if (session.status !== 'PENDING') {
        throw new Error(`CheckoutSession already processed: ${session.status}`);
      }

      // 3. 세션 상태 업데이트
      const newStatus =
        dto.status === 'SUCCESS'
          ? 'COMPLETED'
          : dto.status === 'CANCEL'
            ? 'CANCELLED'
            : 'COMPLETED';

      await tx
        .update(schema.checkoutSessions)
        .set({
          status: newStatus as any,
          completedAt: new Date(),
          metadata: JSON.stringify({
            ...(session.metadata ? JSON.parse(session.metadata) : {}),
            callback: dto,
          }),
        })
        .where(eq(schema.checkoutSessions.id, sessionId));

      // 4. 결제 성공 시 Intent/Attempt 자동 생성
      if (dto.status === 'SUCCESS') {
        await this.createAutomaticAttempt(session, dto, tx);
      }

      this.logger.log(`콜백 처리 완료: ${sessionId} → ${newStatus}`);

      return await this.getSession(sessionId);
    });
  }

  /**
   * CheckoutSession 취소
   */
  async cancelSession(sessionId: string): Promise<CheckoutSessionResponseDto> {
    await this.dbService.db
      .update(schema.checkoutSessions)
      .set({
        status: 'CANCELLED',
        completedAt: new Date(),
      })
      .where(eq(schema.checkoutSessions.id, sessionId));

    return await this.getSession(sessionId);
  }

  /**
   * PG사별 결제창 URL 생성 (Mock)
   */
  private generateCheckoutUrl(
    sessionId: string,
    provider: string,
    amount: number,
    metadata?: any,
  ): string {
    const baseUrl =
      process.env.CHECKOUT_BASE_URL || 'https://checkout.example.com';

    switch (provider) {
      case 'TOSS':
        return `${baseUrl}/toss?sessionId=${sessionId}&amount=${amount}`;
      case 'KAKAOPAY':
        return `${baseUrl}/kakaopay?sessionId=${sessionId}&amount=${amount}`;
      case 'CMS':
        return `${baseUrl}/cms?sessionId=${sessionId}&amount=${amount}`;
      default:
        return `${baseUrl}/generic?sessionId=${sessionId}&provider=${provider}`;
    }
  }

  /**
   * 콜백 성공 시 자동 Attempt 생성
   */
  private async createAutomaticAttempt(
    session: any,
    callback: CheckoutSessionCallbackDto,
    tx: any,
  ): Promise<void> {
    this.logger.log(
      `자동 Attempt 생성: intentId=${session.intentId}, provider=${session.provider}`,
    );

    try {
      // PaymentIntentService를 통해 Attempt 생성
      // 단, 트랜잭션 내부이므로 직접 DB 조작이 필요할 수 있음

      // 임시: Attempt 레코드 직접 생성 (실제로는 PaymentIntentService 사용)
      const attemptId = `pa_${ulid()}`;

      await tx.insert(schema.paymentAttempts).values({
        id: attemptId,
        intentId: session.intentId,
        provider: session.provider,
        instrumentKind: 'EPHEMERAL',
        instrumentRef: callback.pgTransactionId,
        status: callback.status === 'SUCCESS' ? 'CAPTURED' : 'FAILED',
        amount: callback.actualAmount || 0,
        pgTransactionId: callback.pgTransactionId,
        metadata: JSON.stringify({
          source: 'checkout_session',
          sessionId: session.id,
          callback: callback,
        }),
      });

      this.logger.log(`자동 Attempt 생성 완료: ${attemptId}`);
    } catch (error) {
      this.logger.error(`자동 Attempt 생성 실패`, error);
      // 콜백 처리는 성공하되, Attempt 생성 실패는 별도 처리
    }
  }
}
