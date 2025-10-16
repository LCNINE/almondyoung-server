import { Injectable, Logger } from '@nestjs/common';
import { IntentRepository } from './intent.repository';
import type { PaymentIntent } from '../../shared/database/types';
import type { ProviderType } from '../../providers/payment-provider.interface';
import type { WalletExecutor } from '../../shared/database';

/**
 * IntentManager (Implementation Layer)
 *
 * 책임: Intent 비즈니스 로직 (검증 + 상태 관리 + DB 접근)
 */
@Injectable()
export class IntentManager {
  private readonly logger = new Logger(IntentManager.name);

  constructor(private readonly repo: IntentRepository) {}

  /**
   * 결제를 위한 Intent 준비 (검증 포함)
   */
  async prepareForPayment(
    intent: PaymentIntent | null,
    providerType: ProviderType | null,
  ): Promise<PaymentIntent> {
    // 1. 검증
    if (!intent) throw new Error('Intent not found');
    if (intent.status !== 'PENDING' && intent.status !== 'UNKNOWN') {
      throw new Error('Intent not pending');
    }
    if (new Date() > new Date(intent.expiresAt)) {
      throw new Error('Intent expired');
    }

    // 2. UNKNOWN 상태 복구
    if (intent.status === 'UNKNOWN') {
      await this.recoverUnknownIntent(intent, providerType);
      // 복구 후 다시 조회
      const recovered = await this.repo.findById(intent.id);
      if (!recovered) throw new Error('Intent not found after recovery');
      return recovered;
    }

    return intent;
  }

  /**
   * Intent에 할인 정보를 적용합니다.
   */
  async applyDiscounts(
    intent: PaymentIntent | null,
    discounts: any[],
    tx?: WalletExecutor,
  ): Promise<void> {
    if (!intent) throw new Error('Intent not found');

    const discountsTotal = discounts.reduce(
      (sum: number, d: any) => sum + (d.amount || 0),
      0,
    );
    const finalAmount = intent.amount - discountsTotal;

    if (finalAmount < 0) throw new Error('Invalid discount amount');

    await this.repo.updateDiscounts(
      intent.id,
      discounts,
      discountsTotal,
      finalAmount,
      tx,
    );

    this.logger.log(
      `Discounts applied to intent ${intent.id}: ${discountsTotal}`,
    );
  }

  /**
   * Intent를 포인트 전액 결제로 완료 처리합니다.
   */
  async completeAsPointOnly(
    intentId: string,
    tx?: WalletExecutor,
  ): Promise<void> {
    await this.repo.markAsCaptured(intentId, tx);
    this.logger.log(`Intent ${intentId} completed as point-only payment`);
  }

  /**
   * Intent 상태를 업데이트합니다.
   */
  async updateStatus(
    intentId: string,
    status: string,
    tx?: WalletExecutor,
  ): Promise<void> {
    await this.repo.updateStatus(intentId, status, tx);
    this.logger.log(`Intent ${intentId} status updated to ${status}`);
  }

  /**
   * Intent를 UNKNOWN 상태로 표시합니다.
   * (외부 결제는 성공했지만 내부 처리 중 에러 발생 시)
   */
  async markAsUnknown(intentId: string): Promise<void> {
    await this.repo.markAsUnknown(intentId);
    this.logger.warn(`Intent ${intentId} marked as UNKNOWN for recovery`);
  }

  /**
   * UNKNOWN 상태 복구 (내부 메서드)
   */
  private async recoverUnknownIntent(
    intent: PaymentIntent,
    providerType: ProviderType | null,
  ): Promise<void> {
    this.logger.log(`Attempting to recover UNKNOWN intent: ${intent.id}`);

    // TODO: 외부 Provider 상태 확인 후 Intent 상태 동기화
    // 현재는 기본 복구 로직만 수행
    await this.repo.updateStatus(intent.id, 'PENDING');

    this.logger.log(`Intent ${intent.id} recovered from UNKNOWN state`);
  }
}
