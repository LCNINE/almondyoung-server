import { Injectable, Logger } from '@nestjs/common';
import { IntentRepository } from '../intents/intent.repository';
import { PaymentAttemptRepository } from './payment-attempt.repository';
import type { PaymentIntent, PaymentAttempt } from '../../shared/database/types';
import {
  PaymentResult,
  PaymentError,
  ProviderType,
} from '../../providers/payment-provider.interface';

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
  ) { }

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
   * 완료된 결제 상태인지 확인
   */
  private _isCompletedStatus(status: string): boolean {
    return status === 'AUTHORIZED' || status === 'CAPTURED';
  }

  /**
   * 이미 완료된 Intent의 기존 결과를 반환함. (멱등성을 보장하기 위해)
   *
   * - Intent가 이미 AUTHORIZED 또는 CAPTURED 상태이면 기존 Attempt에서 결과를 복원
   * - expectedProvider가 제공되고 기존 Provider와 다르면 에러
   * - 완료된 상태가 아니면 undefined 반환
   *
   * @param intent - 결제 의도
   * @param expectedProvider - 요청된 Provider 타입 (선택)
   * @param tx - 트랜잭션 객체
   * @returns 기존 결제 결과 또는 undefined
   */
  async getCompletedResult(
    intent: PaymentIntent,
    expectedProvider?: ProviderType | null,
    tx?: any,
  ): Promise<PaymentResult | undefined> {
    if (!this._isCompletedStatus(intent.status)) {
      return undefined;
    }

    const attempt = await this.attemptRepo.findSuccessfulByIntentId(
      intent.id,
      tx,
    );

    if (!attempt) {
      this.logger.warn(
        `Intent ${intent.id} is ${intent.status} but no successful attempt found`,
      );
      return undefined;
    }

    // Provider 타입 검증 - 요청한 타입과 기존 타입이 다르면 에러
    if (
      expectedProvider &&
      attempt.provider &&
      attempt.provider !== expectedProvider
    ) {
      throw new PaymentError(
        'PROVIDER_MISMATCH',
        `Payment already completed with ${attempt.provider}, but requested ${expectedProvider}`,
      );
    }

    this.logger.log(
      `Returning existing result for Intent ${intent.id} (idempotency)`,
    );

    return this._buildResultFromAttempt(intent, attempt);
  }

  /**
   * Attempt에서 PaymentResult를 복원함
   */
  private _buildResultFromAttempt(
    intent: PaymentIntent,
    attempt: PaymentAttempt,
  ): PaymentResult {
    const metadata = (attempt.request_payload as any) || {};

    return {
      success: true,
      attemptId: attempt.id,
      transactionId: attempt.transactionId ?? undefined,
      code: 'ALREADY_COMPLETED',
      message: `Payment already ${intent.status.toLowerCase()}`,
      pointEventId: metadata.pointEventId ?? null,
      breakdown: {
        originalAmount: Number(intent.originalAmount),
        pointsUsed: metadata.pointsUsed ?? 0,
        finalAmount: Number(attempt.amount),
      },
    };
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
