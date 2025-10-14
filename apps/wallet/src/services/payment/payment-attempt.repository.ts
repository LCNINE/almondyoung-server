import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { walletSchema } from '../../shared/database/schema';
import * as schema from '../../shared/database/schema';
import { eq, and, inArray } from 'drizzle-orm';
import type { PaymentAttempt } from '../../shared/database/types';
import type {
  PaymentRequest,
  PaymentResult,
  ProviderType,
} from '../../providers/payment-provider.interface';

/**
 * PaymentAttemptRepository
 *
 * 책임:
 * - Attempt 생성 및 조회
 * - Attempt 상태 업데이트
 * - 활성 Attempt 관리 (취소 등)
 */
@Injectable()
export class PaymentAttemptRepository {
  private readonly logger = new Logger(PaymentAttemptRepository.name);

  constructor(private readonly db: DbService<typeof walletSchema>) {}

  /**
   * PaymentAttempt를 생성합니다.
   */
  async create(
    request: PaymentRequest,
    result: PaymentResult,
    providerType: ProviderType,
    status: string,
    tx?: any,
  ): Promise<void> {
    const executor = tx ?? this.db.db;

    await executor.insert(schema.paymentAttempts).values({
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

    this.logger.log(
      `Attempt ${request.attemptId} created with status ${status}`,
    );
  }

  /**
   * Attempt ID로 조회합니다.
   */
  async findById(attemptId: string): Promise<PaymentAttempt | undefined> {
    return this.db.db.query.paymentAttempts.findFirst({
      where: eq(schema.paymentAttempts.id, attemptId),
    });
  }

  /**
   * Attempt ID로 조회하고 존재하지 않으면 에러를 던집니다.
   */
  async findByIdOrFail(attemptId: string): Promise<PaymentAttempt> {
    const attempt = await this.findById(attemptId);
    if (!attempt) {
      throw new Error(`Attempt not found: ${attemptId}`);
    }
    return attempt;
  }

  /**
   * Attempt 상태를 업데이트합니다.
   */
  async updateStatus(
    attemptId: string,
    status: string,
    result: PaymentResult,
    tx?: any,
  ): Promise<void> {
    const executor = tx ?? this.db.db;

    await executor
      .update(schema.paymentAttempts)
      .set({
        status,
        updatedAt: new Date(),
        transactionId: result.transactionId ?? undefined,
      })
      .where(eq(schema.paymentAttempts.id, attemptId));

    this.logger.log(`Attempt ${attemptId} status updated to ${status}`);
  }

  /**
   * 주어진 intentId의 모든 활성 상태 Attempt를 취소합니다.
   * 동시 결제 방지를 위해 사용됩니다.
   *
   * @param intentId - 결제 의도 ID
   * @param tx - 트랜잭션 객체
   * @returns 취소된 시도들의 ID 배열
   */
  async cancelActiveAttempts(intentId: string, tx?: any): Promise<string[]> {
    const executor = tx ?? this.db.db;

    this.logger.log(`Canceling active attempts for intent: ${intentId}`);

    // 활성 상태의 결제 시도들을 조회
    const activeAttempts = await executor.query.paymentAttempts.findMany({
      where: and(
        eq(schema.paymentAttempts.intentId, intentId),
        inArray(schema.paymentAttempts.status, ['AUTHORIZED']),
      ),
    });

    if (activeAttempts.length === 0) {
      this.logger.log(`No active attempts found for intent: ${intentId}`);
      return [];
    }

    const attemptIds = activeAttempts.map((attempt) => attempt.id);
    this.logger.log(
      `Found ${activeAttempts.length} active attempts to cancel: ${attemptIds.join(', ')}`,
    );

    // 모든 활성 시도를 CANCELLED 상태로 업데이트
    await executor
      .update(schema.paymentAttempts)
      .set({
        status: 'CANCELLED',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.paymentAttempts.intentId, intentId),
          inArray(schema.paymentAttempts.status, ['AUTHORIZED']),
        ),
      );

    this.logger.log(
      `Successfully canceled ${attemptIds.length} attempts for intent: ${intentId}`,
    );
    return attemptIds;
  }
}
