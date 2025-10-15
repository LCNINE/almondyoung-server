import { Injectable } from '@nestjs/common';
import { IntentRepository } from './intent.repository';
import type { PaymentIntent } from '../../shared/database/types';
import type { ProviderType } from '../../providers/payment-provider.interface';

/**
 * IntentManager (Implement Layer)
 *
 * 책임:
 * - Intent 관련 구현 로직 조율
 * - Repository 접근을 캡슐화
 * - Business Layer에 필요한 고수준 메서드 제공
 *
 * 레이어 구조:
 * Business Layer (Orchestrator) → Implement Layer (Manager) → Data Access Layer (Repository)
 */
@Injectable()
export class IntentManager {
  constructor(private readonly intentRepo: IntentRepository) {}

  /**
   * Intent를 조회하고 결제 가능 상태로 준비합니다.
   * UNKNOWN 상태인 경우 복구 시도를 포함합니다.
   */
  async prepareForPayment(
    intentId: string,
    providerType: ProviderType | null,
    recoveryFn?: (
      intent: PaymentIntent,
      providerType: ProviderType | null,
    ) => Promise<void>,
  ): Promise<PaymentIntent> {
    const intent = await this.intentRepo.findByIdOrFail(intentId);

    // UNKNOWN 상태 복구 (외부 콜백 사용)
    if ((intent.status as string) === 'UNKNOWN' && recoveryFn) {
      await recoveryFn(intent, providerType);
      // 복구 후 다시 조회
      return this.intentRepo.findByIdOrFail(intentId);
    }

    return intent;
  }

  /**
   * Intent에 할인 정보를 적용합니다.
   */
  async applyDiscounts(
    intentId: string,
    discounts: any[],
    discountsTotal: string,
    finalAmount: string,
    tx?: any,
  ): Promise<void> {
    return this.intentRepo.updateDiscounts(
      intentId,
      discounts,
      discountsTotal,
      finalAmount,
      tx,
    );
  }

  /**
   * Intent를 포인트 전액 결제로 완료 처리합니다.
   */
  async completeAsPointOnly(intentId: string, tx?: any): Promise<void> {
    return this.intentRepo.markAsCaptured(intentId, tx);
  }

  /**
   * Intent 상태를 업데이트합니다.
   */
  async updateStatus(
    intentId: string,
    status: string,
    tx?: any,
  ): Promise<void> {
    return this.intentRepo.updateStatus(intentId, status, tx);
  }

  /**
   * Intent를 UNKNOWN 상태로 표시합니다.
   * (외부 결제는 성공했지만 내부 처리 중 에러 발생 시)
   */
  async markAsUnknown(intentId: string): Promise<void> {
    return this.intentRepo.markAsUnknown(intentId);
  }

  /**
   * Intent를 조회합니다.
   */
  async findById(intentId: string): Promise<PaymentIntent | undefined> {
    return this.intentRepo.findById(intentId);
  }

  /**
   * Intent를 조회하고 존재하지 않으면 에러를 던집니다.
   */
  async findByIdOrFail(intentId: string): Promise<PaymentIntent> {
    return this.intentRepo.findByIdOrFail(intentId);
  }
}
