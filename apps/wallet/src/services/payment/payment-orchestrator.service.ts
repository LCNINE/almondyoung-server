import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../../shared/database/schema';
import { eq } from 'drizzle-orm';
import { PaymentExecutorService } from './payment-executor.service';
import {
  PaymentRequest,
  PaymentResult,
  PaymentType,
  ProviderType,
} from '../../providers/payment-provider.interface';
import { generateUUIDv7 } from '../../shared/utils/id-generator';

@Injectable()
export class PaymentOrchestratorService {
  private readonly logger = new Logger(PaymentOrchestratorService.name);

  constructor(
    private readonly db: DbService<typeof schema>,
    private readonly paymentExecutor: PaymentExecutorService,
  ) {}

  /**
   * 결제 승인(Authorization) - Intent 조회부터 승인 상태 업데이트까지 담당합니다.
   */
  async authorizePayment(
    intentId: string,
    providerType: ProviderType,
    options: {
      profileId?: string;
      instrumentRef?: string;
      sessionId?: string;
      actor?: string;
      source?: string;
    } = {},
  ): Promise<PaymentResult> {
    this.logger.log(
      `Orchestrating payment authorization for Intent: ${intentId} via ${providerType}`,
    );

    const intent = await this.db.db.query.paymentIntents.findFirst({
      where: eq(schema.paymentIntents.id, intentId),
    });

    if (!intent) {
      throw new Error(`Intent not found: ${intentId}`);
    }

    const paymentRequest: PaymentRequest = {
      intentId: intent.id,
      attemptId: generateUUIDv7(),
      amount: intent.amount,
      paymentType: intent.type as PaymentType,
      userId: intent.customerId,
      instrumentType: options.profileId ? 'PROFILE' : 'ONE_TIME',
      profileId: options.profileId,
      instrumentRef: options.instrumentRef,
      metadata: {
        sessionId: options.sessionId,
        source: options.source || 'api',
        actor: options.actor || 'SYSTEM',
      },
    };

    // ✨ [핵심 개선] 모든 DB 업데이트를 하나의 트랜잭션으로 묶어 원자성을 보장합니다.
    return this.db.db.transaction(async (tx) => {
      try {
        // 1. Executor에게 결제 승인을 위임 (트랜잭션 컨텍스트 전달)
        const result = await this.paymentExecutor.authorize(
          paymentRequest,
          providerType,
          intent,
          { tx },
        );

        // 2. 성공 시 모든 관련 상태를 이 트랜잭션 안에서 업데이트합니다.
        await this.saveAttemptRecord(
          paymentRequest,
          result,
          providerType,
          'AUTHORIZED',
          tx,
        );
        await this.updateIntentStatus(
          intentId,
          result,
          paymentRequest,
          'AUTHORIZED',
          tx,
        );
        if (options.sessionId) {
          await this.updateCheckoutSessionStatus(options.sessionId, result, tx);
        }

        // ✨ attemptId를 결과에 포함
        result.attemptId = paymentRequest.attemptId;

        this.logger.log(
          `Authorization successful for Intent: ${intentId}, Success: ${result.success}`,
        );
        return result;
      } catch (error: any) {
        this.logger.error(
          `Authorization failed for Intent: ${intentId}`,
          error.stack,
        );

        // 3. 실패 시에도 필요한 기록은 남기고, 트랜잭션은 롤백됩니다.
        const failedResult: PaymentResult = {
          success: false,
          code: error.code,
          message: error.message,
        };
        await this.saveAttemptRecord(
          paymentRequest,
          failedResult,
          providerType,
          'FAILED',
          tx,
        );
        if (options.sessionId) {
          await this.updateCheckoutSessionStatus(
            options.sessionId,
            failedResult,
            tx,
          );
        }

        // 에러를 다시 던져서 트랜잭션을 롤백시키고 호출자에게 알림
        throw error;
      }
    });
  }

  /**
   * 결제 캡처(Capture) - 이미 승인된 결제를 실제로 정산 처리합니다.
   */
  async capturePayment(
    intentId: string,
    attemptId: string,
    amount?: number,
    options: {
      sessionId?: string;
      actor?: string;
      source?: string;
    } = {},
  ): Promise<PaymentResult> {
    this.logger.log(
      `Orchestrating payment capture for Intent: ${intentId}, Attempt: ${attemptId}`,
    );

    // Intent와 Attempt 조회
    const [intent, attempt] = await Promise.all([
      this.db.db.query.paymentIntents.findFirst({
        where: eq(schema.paymentIntents.id, intentId),
      }),
      this.db.db.query.paymentAttempts.findFirst({
        where: eq(schema.paymentAttempts.id, attemptId),
      }),
    ]);

    if (!intent) {
      throw new Error(`Intent not found: ${intentId}`);
    }

    if (!attempt) {
      throw new Error(`Attempt not found: ${attemptId}`);
    }

    if (attempt.status !== 'AUTHORIZED') {
      throw new Error(
        `Attempt ${attemptId} is not in AUTHORIZED status: ${attempt.status}`,
      );
    }

    const captureAmount = amount || attempt.amount;

    return this.db.db.transaction(async (tx) => {
      try {
        // 1. Executor에게 결제 캡처를 위임
        const result = await this.paymentExecutor.capture(
          attemptId,
          attempt.provider as ProviderType,
          captureAmount,
          { tx },
        );

        // 2. 성공 시 Attempt와 Intent 상태를 업데이트
        await this.updateAttemptStatus(attemptId, 'CAPTURED', result, tx);
        await this.updateIntentStatus(intentId, result, null, 'CAPTURED', tx);

        if (options.sessionId) {
          await this.updateCheckoutSessionStatus(options.sessionId, result, tx);
        }

        this.logger.log(
          `Capture successful for Intent: ${intentId}, Attempt: ${attemptId}`,
        );
        return result;
      } catch (error: any) {
        this.logger.error(
          `Capture failed for Intent: ${intentId}, Attempt: ${attemptId}`,
          error.stack,
        );

        // 실패 시 상태 업데이트
        const failedResult: PaymentResult = {
          success: false,
          code: error.code,
          message: error.message,
        };

        await this.updateAttemptStatus(
          attemptId,
          'CAPTURE_FAILED',
          failedResult,
          tx,
        );

        throw error;
      }
    });
  }

  // ✨ [신규] Checkout Session의 상태를 업데이트하는 책임 추가
  private async updateCheckoutSessionStatus(
    sessionId: string,
    result: PaymentResult,
    tx: any, // Drizzle 트랜잭션 객체
  ): Promise<void> {
    this.logger.log(
      `Updating Checkout Session ${sessionId} status to ${result.success ? 'COMPLETED' : 'CANCELLED'}`,
    );
    await tx
      .update(schema.checkoutSessions)
      .set({
        status: result.success ? 'COMPLETED' : 'CANCELLED',
      })
      .where(eq(schema.checkoutSessions.id, sessionId));
  }

  // ✨ [수정] 트랜잭션 객체(tx)와 명시적 상태를 받도록 수정
  private async saveAttemptRecord(
    request: PaymentRequest,
    result: PaymentResult,
    providerType: ProviderType,
    status: string,
    tx: any,
  ): Promise<void> {
    await tx.insert(schema.paymentAttempts).values({
      id: request.attemptId,
      intentId: request.intentId,
      provider: providerType,
      instrumentType: request.instrumentType,
      profileId: request.profileId || null,
      amount: request.amount,
      status: result.success ? status : 'FAILED',
      transactionId: result.transactionId ?? null,
      eventContext: JSON.stringify(request.metadata),
    });
  }

  // ✨ [수정] 트랜잭션 객체(tx)와 명시적 상태를 받도록 수정
  private async updateIntentStatus(
    intentId: string,
    result: PaymentResult,
    request: PaymentRequest | null,
    status: string,
    tx: any,
  ): Promise<void> {
    await tx
      .update(schema.paymentIntents)
      .set({
        status: result.success ? status : 'FAILED',
        updatedAt: new Date(),
      })
      .where(eq(schema.paymentIntents.id, intentId));
  }

  // ✨ [신규] Attempt 상태만 업데이트하는 헬퍼 메서드
  private async updateAttemptStatus(
    attemptId: string,
    status: string,
    result: PaymentResult,
    tx: any,
  ): Promise<void> {
    await tx
      .update(schema.paymentAttempts)
      .set({
        status,
        updatedAt: new Date(),
        transactionId: result.transactionId ?? undefined,
      })
      .where(eq(schema.paymentAttempts.id, attemptId));
  }
}
