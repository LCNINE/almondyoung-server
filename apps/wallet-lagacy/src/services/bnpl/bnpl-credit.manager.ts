import { Injectable, Logger } from '@nestjs/common';
import { BnplAccount } from '../../shared/database/types';
import { WalletExecutor } from '../../shared/database';
import { BnplRepository } from './bnpl.repository';
import { getTsid } from 'tsid-ts';

/**
 * BnplCreditManager - BNPL 한도 관리 (Implementation Layer)
 *
 * 책임: 신용 한도 관련 모든 비즈니스 로직 (검증 + 이벤트 생성 + 한도 변경)
 */
@Injectable()
export class BnplCreditManager {
  private readonly logger = new Logger(BnplCreditManager.name);

  constructor(private readonly repo: BnplRepository) {}

  /**
   * 구매 시 신용 사용 (검증 + 이벤트 생성 + 한도 차감)
   */
  async useCreditForPurchase(
    account: BnplAccount | null,
    amount: number,
    orderId: string,
    intentId: string,
    tx?: WalletExecutor,
  ): Promise<void> {
    // 1. 검증
    if (!account) throw new Error('Account not found');
    if (account.status !== 'ACTIVE') throw new Error('Account not active');
    if (account.availableLimit < amount) throw new Error('Insufficient credit');

    // 2. 이벤트 생성
    const event = await this.repo.createEvent(
      {
        id: getTsid().toString(),
        accountId: account.id,
        eventType: 'PURCHASE' as any,
        eventCategory: 'CREDIT' as any,
        amount,
        externalOrderId: orderId,
        paymentIntentId: intentId,
        aggregationPeriod: new Date().toISOString().slice(0, 7),
        isAggregated: false,
        status: 'PENDING',
        actor: 'SYSTEM',
      },
      tx,
    );

    // 3. 이벤트 상세 생성
    const detail = await this.repo.createEventDetail(
      {
        id: getTsid().toString(),
        eventId: event.id,
        accountId: account.id,
        eventType: 'PURCHASE',
        amount,
        purchaseEventDetailId: null,
        originalEventDetailId: null,
        balanceBefore: account.creditLimit - account.availableLimit,
        balanceAfter: account.creditLimit - account.availableLimit + amount,
        availableBefore: account.availableLimit,
        availableAfter: account.availableLimit - amount,
      },
      tx,
    );

    await this.repo.updateEventDetail(
      detail.id,
      {
        purchaseEventDetailId: detail.id,
        originalEventDetailId: detail.id,
      },
      tx,
    );

    // 4. 한도 차감
    await this.repo.updateAccount(
      account.id,
      { availableLimit: account.availableLimit - amount },
      tx,
    );

    this.logger.log(`Credit used for purchase: ${amount}, order: ${orderId}`);
  }

  /**
   * 결제 성공 시 한도 복원 (검증 + 이벤트 생성 + 한도 복원)
   */
  async restoreCreditForPayment(
    account: BnplAccount | null,
    amount: number,
    batchId: string,
    aggregationPeriod: string,
    tx?: WalletExecutor,
  ): Promise<void> {
    if (!account) throw new Error('Account not found');

    // 1. 상환 이벤트 생성
    await this.repo.createEvent(
      {
        id: getTsid().toString(),
        accountId: account.id,
        eventType: 'PAYMENT_SUCCESS' as any,
        eventCategory: 'DEBIT' as any,
        amount: -amount,
        aggregationPeriod,
        isAggregated: true,
        batchTransactionId: batchId,
        batchDueDate: new Date().toISOString().split('T')[0],
        status: 'COMPLETED' as any,
        actor: 'SYSTEM',
      },
      tx,
    );

    // 2. 한도 복원
    await this.repo.updateAccount(
      account.id,
      { availableLimit: account.availableLimit + amount },
      tx,
    );

    this.logger.log(
      `Credit restored for payment: ${amount}, batch: ${batchId}`,
    );
  }

  /**
   * 실패 시 한도 복원 (검증 + 한도 복원만)
   */
  async restoreCreditForFailure(
    account: BnplAccount | null,
    amount: number,
    tx?: WalletExecutor,
  ): Promise<void> {
    if (!account) throw new Error('Account not found');

    await this.repo.updateAccount(
      account.id,
      { availableLimit: account.availableLimit + amount },
      tx,
    );

    this.logger.log(`Credit restored for failure: ${amount}`);
  }

  /**
   * 다음 결제일 업데이트
   */
  async updateNextBillingDate(
    accountId: string,
    tx?: WalletExecutor,
  ): Promise<void> {
    const nextBillingDate = this.calculateNextBillingDate(new Date());

    await this.repo.updateAccount(
      accountId,
      {
        nextBillingDate,
        billingCycleStart: new Date().toISOString().split('T')[0],
        billingCycleEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split('T')[0],
      },
      tx,
    );

    this.logger.log(`Next billing date updated: ${nextBillingDate}`);
  }

  /**
   * 이벤트 집계 표시
   */
  async markEventsAsAggregated(
    accountId: string,
    batchTransactionId: string,
    batchDueDate: string,
    tx?: WalletExecutor,
  ): Promise<void> {
    await this.repo.updateEventsForAggregation(
      accountId,
      batchTransactionId,
      batchDueDate,
      tx,
    );

    this.logger.log(
      `Events marked as aggregated for batch: ${batchTransactionId}`,
    );
  }

  /**
   * 배치 실패 처리
   */
  async failEventsByBatch(batchId: string, tx: WalletExecutor): Promise<void> {
    const events = await this.repo.findEventsByBatchId(batchId, tx);
    const ids = events.map((e: any) => e.id);

    if (ids.length === 0) return;

    await this.repo.updateEventsByIds(ids, { status: 'FAILED' }, tx);

    this.logger.log(`Failed ${ids.length} events for batch: ${batchId}`);
  }

  private calculateNextBillingDate(baseDate: Date): string {
    const nextDate = new Date(baseDate.getTime() + 30 * 24 * 60 * 60 * 1000);
    const dayOfWeek = nextDate.getDay();
    if (dayOfWeek === 0) nextDate.setDate(nextDate.getDate() + 1);
    else if (dayOfWeek === 6) nextDate.setDate(nextDate.getDate() + 2);
    return nextDate.toISOString().split('T')[0];
  }
}
