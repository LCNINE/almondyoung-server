import { Injectable } from '@nestjs/common';
import { IntentReader } from './intent.reader';
import { IntentCreator, CreateIntentParams } from './intent.creator';
import { IntentManager } from './intent.manager';
import type { PaymentIntent } from '../../shared/database/types';
import type { ProviderType } from '../../providers/payment-provider.interface';
import type { WalletExecutor } from '../../shared/database';

/**
 * IntentService (Business Layer)
 *
 * 책임: 비즈니스 흐름만 표현 (2-3줄)
 * - DB 직접 참조 제거
 * - Reader/Manager를 통해서만 접근
 */
@Injectable()
export class IntentService {
  constructor(
    private readonly intentReader: IntentReader,
    private readonly intentCreator: IntentCreator,
    private readonly intentManager: IntentManager,
  ) {}

  /**
   * Intent 생성
   */
  async createIntent(
    params: CreateIntentParams,
    tx?: WalletExecutor,
  ): Promise<PaymentIntent> {
    return await this.intentCreator.create(params, tx);
  }

  /**
   * 결제를 위한 Intent 준비
   */
  async prepareForPayment(
    intentId: string,
    providerType: ProviderType,
  ): Promise<PaymentIntent> {
    const intent = await this.intentReader.findById(intentId);
    return await this.intentManager.prepareForPayment(intent, providerType);
  }

  /**
   * Intent 상태 업데이트
   */
  async updateStatus(
    intentId: string,
    status: string,
    tx?: WalletExecutor,
  ): Promise<void> {
    await this.intentManager.updateStatus(intentId, status, tx);
  }

  /**
   * 할인 적용
   */
  async applyDiscounts(
    intentId: string,
    discounts: any[],
    tx?: WalletExecutor,
  ): Promise<void> {
    const intent = await this.intentReader.findById(intentId);
    await this.intentManager.applyDiscounts(intent, discounts, tx);
  }

  /**
   * 포인트 전액 결제 완료
   */
  async completeAsPointOnly(
    intentId: string,
    tx?: WalletExecutor,
  ): Promise<void> {
    await this.intentManager.completeAsPointOnly(intentId, tx);
  }

  /**
   * Intent 조회
   */
  async findById(intentId: string): Promise<PaymentIntent | null> {
    return await this.intentReader.findById(intentId);
  }
}
