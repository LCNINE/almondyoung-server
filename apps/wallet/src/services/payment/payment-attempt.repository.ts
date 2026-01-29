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
    data: {
      attemptId: string;
      intentId: string;
      provider: ProviderType;
      profileId?: string;
      amount: number;
      metadata?: Record<string, any>;
    },
    result: PaymentResult,
    status: string,
    tx?: any,
  ): Promise<void> {
    const executor = tx ?? this.db.db;

    await executor.insert(schema.paymentAttempts).values({
      id: data.attemptId,
      intentId: data.intentId,
      provider: data.provider,
      profileId: data.profileId || null,
      amount: data.amount,
      status: result.success ? status : 'FAILED',
      transactionId: result.transactionId ?? null,
      request_payload: data.metadata ?? null,
      provider_raw_response: result.raw ?? null,
    });

    this.logger.log(`Attempt ${data.attemptId} created with status ${status}`);
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
        provider_raw_response: result.raw ?? undefined,
      })
      .where(eq(schema.paymentAttempts.id, attemptId));

    this.logger.log(`Attempt ${attemptId} status updated to ${status}`);
  }

  /**
   * 여러 Attempt의 상태를 일괄 업데이트합니다.
   */
  async updateStatusBatch(
    attemptIds: string[],
    status: string,
    tx?: any,
  ): Promise<void> {
    if (attemptIds.length === 0) return;

    const executor = tx ?? this.db.db;

    await executor
      .update(schema.paymentAttempts)
      .set({
        status,
        updatedAt: new Date(),
      })
      .where(inArray(schema.paymentAttempts.id, attemptIds));

    this.logger.log(
      `Batch updated ${attemptIds.length} attempts to status ${status}`,
    );
  }

  /**
   * Provider별 에러 메시지를 추출합니다.
   * providerResponseSnapshot에서 에러 정보를 파싱합니다.
   */
  getErrorMessage(attempt: PaymentAttempt): string | null {
    if (!attempt.provider_raw_response) {
      return null;
    }

    try {
      const response =
        typeof attempt.provider_raw_response === 'string'
          ? JSON.parse(attempt.provider_raw_response)
          : attempt.provider_raw_response;

      // Provider별 에러 메시지 추출
      switch (attempt.provider) {
        case 'HMS_CARD':
          // HMS 카드 응답 형식: payment.result.message
          return (
            response?.payment?.result?.message ||
            response?.errorMessage ||
            response?.message ||
            null
          );

        case 'HMS_BNPL':
          // HMS BNPL 응답 형식: message 또는 errorMessage
          return response?.message || response?.errorMessage || null;

        case 'TOSS':
        case 'KAKAOPAY':
          // Toss/Kakao 응답 형식: message 또는 code
          return response?.message || `Error code: ${response?.code}` || null;

        case 'POINTS':
          // 포인트 시스템 에러
          return response?.error || response?.message || null;

        default:
          // 일반적인 에러 형식 fallback
          if (response.errorMessage) return response.errorMessage;
          if (response.message) return response.message;
          if (response.error) {
            return typeof response.error === 'string'
              ? response.error
              : response.error.message || JSON.stringify(response.error);
          }
          return null;
      }
    } catch (error) {
      this.logger.warn(
        `Failed to parse providerResponseSnapshot for attempt ${attempt.id}: ${error}`,
      );
      return null;
    }
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
