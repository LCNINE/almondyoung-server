import { Injectable, Logger } from '@nestjs/common';
import { BnplAccountReader } from './bnpl-account.reader';
import { BnplAccountCreator } from './bnpl-account.creator';
import { BnplCreditManager } from './bnpl-credit.manager';
import { BnplAccount } from '../../shared/database/types';
import { BnplRepository } from './bnpl.repository';
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
    private readonly repo: BnplRepository,
  ) {}

  /**
   * BNPL 계정 생성
   */
  async createAccount(userId: string, creditLimit: number, tx?: WalletExecutor): Promise<BnplAccount> {
    const existing = await this.accountReader.findByUserId(userId, tx);
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
    await this.creditManager.useCreditForPurchase(account, amount, orderId, intentId, tx);
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
    await this.creditManager.restoreCreditForPayment(account, amount, batchId, aggregationPeriod, tx);
  }

  /**
   * 실패 시 한도 복원
   */
  async restoreCreditForFailure(accountId: string, amount: number, tx?: WalletExecutor): Promise<void> {
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
    await this.creditManager.markEventsAsAggregated(accountId, batchTransactionId, batchDueDate, tx);
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
  async updateNextBillingDate(accountId: string, tx?: WalletExecutor): Promise<void> {
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
  async findAccountByUserId(userId: string, tx?: WalletExecutor): Promise<BnplAccount | null> {
    return await this.accountReader.findByUserId(userId, tx);
  }

  /**
   * BNPL 내역 조회
   * @param userId 사용자 ID
   * @param year 연도 (optional, 없으면 전체 내역)
   * @param month 월 (optional, 없으면 전체 내역)
   */
  async getBnplHistory(userId: string, year?: number, month?: number) {
    const account = await this.accountReader.findByUserId(userId);
    if (!account) {
      throw new Error('BNPL account not found');
    }

    let events;
    if (year !== undefined && month !== undefined) {
      // 특정 월 조회
      events = await this.repo.findEventsByAccountIdAndPeriod(account.id, year, month);
    } else {
      // 전체 내역 조회
      events = await this.repo.findEventsByAccountId(account.id);
    }

    const totalAmount = events.reduce((sum, event) => sum + event.amount, 0);

    return {
      year: year ?? null,
      month: month ?? null,
      totalAmount,
      events: events.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        eventCategory: event.eventCategory,
        amount: event.amount,
        status: event.status,
        createdAt: event.createdAt.toISOString(),
        title: event.externalOrderId || '알 수 없는 상점', // TODO: 상점명 연동 필요
      })),
    };
  }

  /**
   * BNPL 요약 조회
   */
  async getBnplSummary(userId: string) {
    const account = await this.accountReader.findByUserId(userId);
    if (!account) {
      return {
        success: true,
        hasAccount: false,
        creditLimit: null,
        availableLimit: null,
        usedAmount: 0, // null 대신 0 반환
        nextBillingDate: null,
        dDay: null,
        targetYear: null,
        targetMonth: null,
      };
    }

    // 이번 달 사용 금액 (미정산 금액)
    const usedAmount = await this.repo.getUnbilledAmount(account.id);

    // 결제일까지 남은 일수 및 청구 대상 월 계산
    let dDay: number | null = null;
    let targetYear: number | null = null;
    let targetMonth: number | null = null;

    if (account.nextBillingDate) {
      const today = new Date();
      const billingDate = new Date(account.nextBillingDate);
      const diffTime = billingDate.getTime() - today.getTime();
      dDay = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      // 청구 대상 월 = 결제일의 전달
      // 예: 6월 10일 결제 -> 5월 사용분
      const targetDate = new Date(billingDate.getFullYear(), billingDate.getMonth() - 1, 1);
      targetYear = targetDate.getFullYear();
      targetMonth = targetDate.getMonth() + 1;
    }

    return {
      success: true,
      hasAccount: true,
      creditLimit: account.creditLimit,
      availableLimit: account.availableLimit,
      usedAmount: usedAmount ?? 0, // null이면 0 반환
      nextBillingDate: account.nextBillingDate,
      dDay,
      targetYear,
      targetMonth,
    };
  }
}
