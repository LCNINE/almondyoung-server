import { Injectable, Logger } from '@nestjs/common';
import { IntentRepository } from '../intents/intent.repository';
import { PaymentAttemptRepository } from './payment-attempt.repository';
import type { PaymentIntent } from '../../shared/database/types';

/**
 * PaymentManager (Implementation Layer)
 *
 * 책임: Payment 상태 관리 (검증 + 상태 업데이트)
 */
@Injectable()
export class PaymentManager {
  private readonly logger = new Logger(PaymentManager.name);

  constructor(
    private readonly intentRepo: IntentRepository,
    private readonly attemptRepo: PaymentAttemptRepository,
  ) {}

  /**
   * Intent 검증 및 준비
   */
  async prepareIntent(intent: PaymentIntent): Promise<void> {
    // 1. 상태 검증
    if (intent.status !== 'PENDING' && intent.status !== 'UNKNOWN') {
      throw new Error(
        `Intent not in valid state for payment. Current status: ${intent.status}`,
      );
    }

    // 2. 만료 검증
    if (new Date() > new Date(intent.expiresAt)) {
      throw new Error(`Intent expired at ${intent.expiresAt}`);
    }

    this.logger.log(`Intent ${intent.id} prepared for payment`);
  }

  /**
   * 기존 활성 결제 취소 (동시 결제 방지)
   */
  async cancelActiveAttempts(intentId: string, tx: any): Promise<string[]> {
    const canceledIds = await this.attemptRepo.cancelActiveAttempts(
      intentId,
      tx,
    );

    if (canceledIds.length > 0) {
      this.logger.log(
        `Canceled ${canceledIds.length} active attempts for intent ${intentId}`,
      );
    }

    return canceledIds;
  }

  /**
   * Intent와 Attempt 상태 업데이트
   */
  async updateStatus(
    intentId: string,
    attemptId: string | null,
    status: string,
    result: any,
    tx: any,
  ): Promise<void> {
    // Intent 상태 업데이트
    await this.intentRepo.updateStatus(intentId, status, tx);

    // Attempt 상태 업데이트 (있는 경우)
    if (attemptId) {
      await this.attemptRepo.updateStatus(attemptId, status, result, tx);
    }

    this.logger.log(
      `Updated status to ${status} for intent ${intentId}${attemptId ? ` and attempt ${attemptId}` : ''}`,
    );
  }

  /**
   * Intent를 UNKNOWN 상태로 표시
   */
  async markAsUnknown(intentId: string): Promise<void> {
    await this.intentRepo.updateStatus(intentId, 'UNKNOWN');
    this.logger.warn(`Intent ${intentId} marked as UNKNOWN for recovery`);
  }
}
