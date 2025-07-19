import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectDb } from '@app/db';
import { DbService } from '@app/db/db.service';
import { eq, and, gte, lte, sql } from 'drizzle-orm';
import * as schema from '../../shared/schemas/schema';
import { HmsBnplService } from './hms-bnpl.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ulid } from 'ulid';
import { sumDecimalStrings } from '../../payment/utils/money.utils';

/**
 * BNPL 정산 서비스
 *
 * 주요 기능:
 * 1. 월별 정산 배치 생성
 * 2. 정기 결제 처리
 * 3. 정산 상태 관리
 * 4. 배치 CMS 데이터 전송
 */
@Injectable()
export class BnplSettlementService {
  private readonly logger = new Logger(BnplSettlementService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
    private readonly hmsBnplService: HmsBnplService,
  ) {
    this.logger.log('🚀 BNPL 정산 서비스 초기화 완료');
  }

  /**
   * 월별 정산 배치 생성
   * 매월 1일 새벽 2시에 실행
   */
  @Cron('0 2 1 * *')
  async createMonthlySettlementBatch(): Promise<void> {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-11
    const batchMonth = `${year}-${String(month + 1).padStart(2, '0')}`;

    this.logger.log(`월별 정산 배치 생성 시작: ${batchMonth}`);

    // 활성화된 모든 BNPL 계정 조회
    const activeAccounts = await this.dbService.db.query.bnplAccount.findMany({
      where: eq(schema.bnplAccount.status, 'ACTIVE'),
    });

    for (const account of activeAccounts) {
      try {
        await this.createSettlementBatchForAccount(account, batchMonth);
      } catch (error) {
        this.logger.error(
          `정산 배치 생성 실패: accountId=${account.id}, error=${error.message}`,
        );
      }
    }

    this.logger.log(`월별 정산 배치 생성 완료: ${batchMonth}`);
  }

  /**
   * 특정 계정의 정산 배치 생성
   */
  async createSettlementBatchForAccount(
    account: any,
    batchMonth: string,
  ): Promise<typeof schema.settlementBatch.$inferSelect> {
    return await this.dbService.db.transaction(async (tx) => {
      // 1. 이미 생성된 배치가 있는지 확인
      const existingBatch = await tx.query.settlementBatch.findFirst({
        where: and(
          eq(schema.settlementBatch.bnplAccountId, account.id),
          eq(schema.settlementBatch.batchNumber, batchMonth),
        ),
      });

      if (existingBatch) {
        this.logger.log(
          `이미 생성된 배치 존재: ${batchMonth}, accountId=${account.id}`,
        );
        return existingBatch;
      }

      // 2. 정산 기간 계산
      const [year, month] = batchMonth.split('-').map(Number);
      const batchPeriodStart = new Date(year, month - 1, 1);
      const batchPeriodEnd = new Date(year, month, 0, 23, 59, 59);

      // 결제일 계산 (다음 달 billingCycleDay일)
      const dueDate = new Date(year, month, account.billingCycleDay);

      // 3. 해당 기간의 거래 내역 조회
      const transactions = await tx.query.bnplTransaction.findMany({
        where: and(
          eq(schema.bnplTransaction.bnplAccountId, account.id),
          eq(schema.bnplTransaction.transactionType, 'DEBIT'),
          eq(schema.bnplTransaction.status, 'CAPTURED'),
          gte(schema.bnplTransaction.createdAt, batchPeriodStart),
          lte(schema.bnplTransaction.createdAt, batchPeriodEnd),
        ),
      });

      // 4. 총 금액 계산
      let totalAmount = 0;
      transactions.forEach((tx) => {
        totalAmount += tx.amount;
      });

      // 5. 정산 배치 생성
      const [settlementBatch] = await tx
        .insert(schema.settlementBatch)
        .values({
          bnplAccountId: account.id,
          batchNumber: batchMonth,
          totalAmount: totalAmount,
          dueDate,
          status: 'PENDING',
          batchPeriodStart,
          batchPeriodEnd,
        })
        .returning();

      // 6. 정산 배치 항목 생성
      if (transactions.length > 0) {
        await tx.insert(schema.settlementBatchItem).values(
          transactions.map((tx) => ({
            id: ulid(),
            batchId: settlementBatch.id,
            bnplTransactionId: tx.id,
            amount: tx.amount,
            transactionDate: tx.createdAt,
          })),
        );
      }

      this.logger.log(
        `정산 배치 생성 완료: batchId=${settlementBatch.id}, ` +
          `총액=${totalAmount}원, 거래건수=${transactions.length}`,
      );

      return settlementBatch;
    });
  }

  /**
   * 정기 결제 처리
   * 매일 새벽 3시에 실행
   */
  @Cron('0 3 * * *')
  async processScheduledBillings(): Promise<void> {
    const today = new Date();
    const billingDay = today.getDate();

    this.logger.log(
      `정기 결제 처리 시작: ${today.toISOString()}, 결제일=${billingDay}`,
    );

    // 오늘이 결제일인 정산 배치 조회
    const pendingBatches =
      await this.dbService.db.query.settlementBatch.findMany({
        where: and(
          eq(schema.settlementBatch.status, 'PENDING'),
          sql`EXTRACT(DAY FROM ${schema.settlementBatch.dueDate}) = ${billingDay}`,
        ),
        with: {
          bnplAccount: true,
        },
      });

    this.logger.log(`처리 대상 정산 배치: ${pendingBatches.length}건`);

    for (const batch of pendingBatches) {
      try {
        await this.processSingleBilling(batch);
      } catch (error) {
        this.logger.error(
          `정기 결제 처리 실패: batchId=${batch.id}, error=${error.message}`,
        );
      }
    }

    this.logger.log('정기 결제 처리 완료');
  }

  /**
   * 개별 정산 배치 결제 처리
   */
  private async processSingleBilling(batch: any): Promise<void> {
    try {
      // 1. 정산 배치 상태를 PROCESSING으로 변경
      await this.dbService.db
        .update(schema.settlementBatch)
        .set({
          status: 'PROCESSING',
          updatedAt: new Date(),
        })
        .where(eq(schema.settlementBatch.id, batch.id));

      // 2. HMS 배치 CMS로 출금 요청
      const withdrawalResult = await this.hmsBnplService.requestWithdrawal({
        memberId: batch.bnplAccount.memberId,
        amount: Number(batch.totalAmount),
        withdrawalDate: new Date().toISOString().split('T')[0],
        merchantTxId: batch.id,
      });

      // 3. 출금 성공 시 정산 배치 상태 업데이트
      if (withdrawalResult.payment.status === 'SUCCESS') {
        await this.dbService.db
          .update(schema.settlementBatch)
          .set({
            status: 'SETTLED',
            updatedAt: new Date(),
          })
          .where(eq(schema.settlementBatch.id, batch.id));

        // 4. BNPL Transaction 이벤트 생성 (Event Sourcing)
        // 정산은 CREDIT 타입 (잔액 차감)
        await this.dbService.db
          .insert(schema.bnplTransaction)
          .values({
            bnplAccountId: batch.bnplAccountId,
            invoiceId: `SETTLEMENT-${batch.id}-${Date.now()}`, // 정산 배치용 Invoice ID
            transactionType: 'CREDIT',
            status: 'CAPTURED',
            amount: batch.totalAmount,
          });

        this.logger.log(
          `정산 완료: batchId=${batch.id}, amount=${batch.totalAmount}, ` +
            `transactionId=${withdrawalResult.payment.transactionId}`,
        );
      } else {
        // payment 객체에 message가 없을 수 있으므로 안전하게 처리
        const errorMessage =
          withdrawalResult.payment.result.message ||
          withdrawalResult.payment.result.message ||
          '알 수 없는 오류';
        throw new Error(`출금 실패: ${errorMessage}`);
      }
    } catch (error) {
      // 출금 실패 시 정산 배치 상태를 FAILED로 변경
      await this.dbService.db
        .update(schema.settlementBatch)
        .set({
          status: 'FAILED',
          updatedAt: new Date(),
        })
        .where(eq(schema.settlementBatch.id, batch.id));

      this.logger.error(
        `정산 실패: batchId=${batch.id}, error=${error.message}`,
      );
      throw error;
    }
  }

  /**
   * 수동 출금 요청
   */
  async requestManualWithdrawal(
    bnplAccountId: string,
    amount: number,
    reason: string,
  ): Promise<any> {
    this.logger.log(
      `수동 출금 요청: accountId=${bnplAccountId}, amount=${amount}, reason=${reason}`,
    );

    // 1. BNPL 계정 조회
    const account = await this.dbService.db.query.bnplAccount.findFirst({
      where: eq(schema.bnplAccount.id, bnplAccountId),
    });

    if (!account) {
      throw new BadRequestException('BNPL 계정을 찾을 수 없습니다.');
    }

    // 2. 잔액 확인 (Event Sourcing - 실시간 계산)
    const currentBalance = await this.calculateCurrentBalance(account.id);
    if (currentBalance < amount) {
      throw new BadRequestException(
        `출금 가능 금액(${currentBalance}원)을 초과합니다.`,
      );
    }

    // 3. HMS 배치 CMS로 출금 요청
    const result = await this.hmsBnplService.requestWithdrawal({
      memberId: account.userId,
      amount,
      withdrawalDate: new Date().toISOString().split('T')[0],
      merchantTxId: `manual_${ulid()}`,
      reason,
    });

    // 4. 성공 시 BNPL Transaction 이벤트 생성 (Event Sourcing)
    if (result.payment.status === 'SUCCESS') {
      await this.dbService.db
        .insert(schema.bnplTransaction)
        .values({
          bnplAccountId,
          invoiceId: `MANUAL-WITHDRAWAL-${ulid()}`, // 수동 출금용 Invoice ID
          transactionType: 'CREDIT',
          status: 'CAPTURED',
          amount,
        });
    }

    return result;
  }

  /**
   * 정산 배치 상태 조회
   */
  async getSettlementBatchStatus(
    bnplAccountId: string,
    batchMonth?: string,
  ): Promise<any[]> {
    const conditions = [
      eq(schema.settlementBatch.bnplAccountId, bnplAccountId),
    ];

    if (batchMonth) {
      conditions.push(eq(schema.settlementBatch.batchNumber, batchMonth));
    }

    const batches = await this.dbService.db.query.settlementBatch.findMany({
      where: and(...conditions),
      with: {
        items: {
          with: {
            bnplTransaction: true,
          },
        },
      },
      orderBy: (batch, { desc }) => [desc(batch.createdAt)],
      limit: 12, // 최근 12개월
    });

    return batches.map((batch) => ({
      id: batch.id,
      batchNumber: batch.batchNumber,
      totalAmount: batch.totalAmount,
      dueDate: batch.dueDate,
      status: batch.status,
      itemCount: batch.items.length,
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
    }));
  }

  /**
   * Event Sourcing: BNPL Transaction 이벤트들을 기반으로 현재 잔액 계산
   */
  private async calculateCurrentBalance(accountId: string): Promise<number> {
    const transactions = await this.dbService.db.query.bnplTransaction.findMany({
      where: eq(schema.bnplTransaction.bnplAccountId, accountId),
      orderBy: (transactions, { asc }) => [asc(transactions.createdAt)],
    });

    let balance = 0;
    for (const transaction of transactions) {
      const amount = Number(transaction.amount);
      if (transaction.transactionType === 'DEBIT') {
        balance += amount; // 사용 금액 증가
      } else if (transaction.transactionType === 'CREDIT') {
        balance -= amount; // 상환 금액 차감
      }
    }

    return Math.max(0, balance); // 음수 방지
  }

  /**
   * 정산 통계 조회
   */
  async getSettlementStatistics(bnplAccountId: string): Promise<{
    totalSettled: number;
    totalPending: number;
    totalFailed: number;
    averageMonthlyAmount: number;
    lastSettlementDate: Date | null;
  }> {
    const batches = await this.dbService.db.query.settlementBatch.findMany({
      where: eq(schema.settlementBatch.bnplAccountId, bnplAccountId),
    });

    const settledBatches = batches.filter((b) => b.status === 'SETTLED');
    const pendingBatches = batches.filter((b) => b.status === 'PENDING');
    const failedBatches = batches.filter((b) => b.status === 'FAILED');

    const totalSettled = settledBatches.reduce(
      (sum, b) => sum + Number(b.totalAmount),
      0,
    );
    const totalPending = pendingBatches.reduce(
      (sum, b) => sum + Number(b.totalAmount),
      0,
    );
    const totalFailed = failedBatches.reduce(
      (sum, b) => sum + Number(b.totalAmount),
      0,
    );

    const averageMonthlyAmount =
      settledBatches.length > 0 ? totalSettled / settledBatches.length : 0;

    const lastSettlement = settledBatches.sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
    )[0];

    return {
      totalSettled,
      totalPending,
      totalFailed,
      averageMonthlyAmount,
      lastSettlementDate: lastSettlement?.updatedAt || null,
    };
  }
}
