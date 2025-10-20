import { Injectable, Logger } from '@nestjs/common';
import { BnplAccountReader } from './bnpl-account.reader';
import { BnplAccountCreator } from './bnpl-account.creator';
import { BnplCreditManager } from './bnpl-credit.manager';
import { BnplAccount } from '../../shared/database/types';
import { WalletExecutor } from '../../shared/database';

/**
 * BnplService - BNPL 도메인 메인 서비스 (Business Layer)
 *
 * 책임: BNPL 도메인의 일반 업무 흐름 (계정, 구매, 결제, 이벤트)
 * 대비: BnplSettlementService는 정산 특화 업무 담당
 */
@Injectable()
export class BnplService {
  private readonly logger = new Logger(BnplService.name);

  constructor(
    private readonly accountReader: BnplAccountReader,
    private readonly accountCreator: BnplAccountCreator,
    private readonly creditManager: BnplCreditManager,
  ) {}

  /**
   * BNPL 계정 생성
   */
  async createAccount(
    userId: string,
    creditLimit: number,
    tx?: WalletExecutor,
  ): Promise<BnplAccount> {
    const existing = await this.accountReader.findByUserId(userId);
    if (existing) throw new Error('Account already exists');

    return await this.accountCreator.create(userId, creditLimit, tx);
  }

  /**
   * 구매 시 신용 사용
   */
  async purchaseWithCredit(
    userId: string,
    amount: number,
    orderId: string,
    intentId: string,
    tx?: WalletExecutor,
  ): Promise<void> {
    const account = await this.accountReader.findByUserId(userId);
    await this.creditManager.useCreditForPurchase(
      account,
      amount,
      orderId,
      intentId,
      tx,
    );
  }

  /**
   * 결제 성공 시 한도 복원
   */
  async completePayment(
    userId: string,
    amount: number,
    batchId: string,
    aggregationPeriod: string,
    tx?: WalletExecutor,
  ): Promise<void> {
    const account = await this.accountReader.findByUserId(userId);
    await this.creditManager.restoreCreditForPayment(
      account,
      amount,
      batchId,
      aggregationPeriod,
      tx,
    );
  }

  /**
   * 실패 시 한도 복원
   */
  async restoreCreditForFailure(
    accountId: string,
    amount: number,
    tx?: WalletExecutor,
  ): Promise<void> {
    const account = await this.accountReader.findById(accountId, tx);
    await this.creditManager.restoreCreditForFailure(account, amount, tx);
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
    await this.creditManager.markEventsAsAggregated(
      accountId,
      batchTransactionId,
      batchDueDate,
      tx,
    );
  }

  /**
   * 배치 실패 처리
   */
  async failEventsByBatch(batchId: string, tx: WalletExecutor): Promise<void> {
    await this.creditManager.failEventsByBatch(batchId, tx);
  }

  /**
   * 다음 결제일 업데이트
   */
  async updateNextBillingDate(
    accountId: string,
    tx?: WalletExecutor,
  ): Promise<void> {
    await this.creditManager.updateNextBillingDate(accountId, tx);
  }

  /**
   * 청구 대상 계정 조회
   */
  async findAccountsForBilling(): Promise<BnplAccount[]> {
    return await this.accountReader.findAccountsForBilling();
  }

  /**
   * 미정산 금액 조회
   */
  async getUnbilledAmount(accountId: string): Promise<number> {
    return await this.accountReader.getUnbilledAmount(accountId);
  }

  /**
   * 계정 조회
   */
  async findAccountByUserId(userId: string): Promise<BnplAccount | null> {
    return await this.accountReader.findByUserId(userId);
  }
}
