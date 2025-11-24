import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { walletSchema } from '../../shared/database/schema';
import * as schema from '../../shared/database/schema';
import { eq, desc, and, lte, sum, inArray, sql, between } from 'drizzle-orm';
import { BnplAccount, BnplEvent } from '../../shared/database/types';
import { WalletExecutor } from '../../shared/database';

/**
 * BnplRepository - BNPL 도메인 통합 Repository
 *
 * 책임:
 * - BNPL 도메인의 모든 데이터 접근 로직 통합
 * - Account, Event, CMS Response 테이블 접근
 */
@Injectable()
export class BnplRepository {
  private readonly logger = new Logger(BnplRepository.name);

  constructor(private readonly db: DbService<typeof walletSchema>) { }

  // ============================================
  // Account 관련
  // ============================================

  async findAccountByUserId(userId: string): Promise<BnplAccount | null> {
    const account = await this.db.db.query.bnplAccounts.findFirst({
      where: eq(schema.bnplAccounts.userId, userId),
    });
    return account ?? null;
  }

  async findAccountById(
    accountId: string,
    tx?: WalletExecutor,
  ): Promise<BnplAccount | null> {
    const executor = tx || this.db.db;
    const account = await executor.query.bnplAccounts.findFirst({
      where: eq(schema.bnplAccounts.id, accountId),
    });
    return account ?? null;
  }

  async findAccountsForBilling(): Promise<BnplAccount[]> {
    const today = new Date().toISOString().split('T')[0];
    return this.db.db.query.bnplAccounts.findMany({
      where: and(
        eq(schema.bnplAccounts.status, 'ACTIVE'),
        lte(schema.bnplAccounts.nextBillingDate, today),
      ),
      orderBy: [desc(schema.bnplAccounts.nextBillingDate)],
    });
  }

  async createAccount(data: any, tx?: WalletExecutor): Promise<BnplAccount> {
    const executor = tx || this.db.db;
    const [account] = await executor
      .insert(schema.bnplAccounts)
      .values(data)
      .returning();
    return account;
  }

  async updateAccount(
    accountId: string,
    data: Partial<BnplAccount>,
    tx?: WalletExecutor,
  ): Promise<void> {
    const executor = tx || this.db.db;
    await executor
      .update(schema.bnplAccounts)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.bnplAccounts.id, accountId));
  }

  // ============================================
  // Event 관련
  // ============================================

  async createEvent(data: any, tx?: WalletExecutor): Promise<BnplEvent> {
    const executor = tx || this.db.db;
    const [event] = await executor
      .insert(schema.bnplEvents)
      .values(data)
      .returning();
    return event;
  }

  async createEventDetail(data: any, tx?: WalletExecutor): Promise<any> {
    const executor = tx || this.db.db;
    const [detail] = await executor
      .insert(schema.bnplEventDetails)
      .values(data)
      .returning();
    return detail;
  }

  async updateEventDetail(
    detailId: string,
    data: any,
    tx?: WalletExecutor,
  ): Promise<void> {
    const executor = tx || this.db.db;
    await executor
      .update(schema.bnplEventDetails)
      .set(data)
      .where(eq(schema.bnplEventDetails.id, detailId));
  }

  async findEventsByBatchId(
    batchId: string,
    tx?: WalletExecutor,
  ): Promise<BnplEvent[]> {
    const executor = tx || this.db.db;
    return executor.query.bnplEvents.findMany({
      where: eq(schema.bnplEvents.batchTransactionId, batchId),
    });
  }

  async updateEventsByBatchId(
    batchId: string,
    data: Partial<BnplEvent>,
    tx?: WalletExecutor,
  ): Promise<void> {
    const executor = tx || this.db.db;
    await executor
      .update(schema.bnplEvents)
      .set(data)
      .where(eq(schema.bnplEvents.batchTransactionId, batchId));
  }

  async updateEventsByIds(
    eventIds: string[],
    data: Partial<BnplEvent>,
    tx?: WalletExecutor,
  ): Promise<void> {
    const executor = tx || this.db.db;
    await executor
      .update(schema.bnplEvents)
      .set(data)
      .where(inArray(schema.bnplEvents.id, eventIds));
  }

  async updateEventsForAggregation(
    accountId: string,
    batchTransactionId: string,
    batchDueDate: string,
    tx?: WalletExecutor,
  ): Promise<void> {
    const executor = tx || this.db.db;
    await executor
      .update(schema.bnplEvents)
      .set({
        isAggregated: true,
        batchTransactionId,
        batchDueDate,
        status: 'PENDING',
      })
      .where(
        and(
          eq(schema.bnplEvents.accountId, accountId),
          eq(schema.bnplEvents.eventCategory, 'CREDIT'),
          eq(schema.bnplEvents.isAggregated, false),
          eq(schema.bnplEvents.status, 'PENDING' as any),
        ),
      );
  }

  async findPendingEventsForBatch(tx?: WalletExecutor): Promise<BnplEvent[]> {
    const executor = tx || this.db.db;
    return executor.query.bnplEvents.findMany({
      where: and(
        eq(schema.bnplEvents.isAggregated, false),
        eq(schema.bnplEvents.status, 'PENDING'),
      ),
    });
  }

  async findFailedEventsByBatchId(
    batchId: string,
    tx?: WalletExecutor,
  ): Promise<BnplEvent[]> {
    const executor = tx || this.db.db;
    return executor.query.bnplEvents.findMany({
      where: and(
        eq(schema.bnplEvents.batchTransactionId, batchId),
        eq(schema.bnplEvents.cmsStatus, 'FAILED'),
      ),
    });
  }

  async getUnbilledAmount(accountId: string): Promise<number> {
    const result = await this.db.db
      .select({ total: sum(schema.bnplEvents.amount) })
      .from(schema.bnplEvents)
      .where(
        and(
          eq(schema.bnplEvents.accountId, accountId),
          eq(schema.bnplEvents.eventType, 'PURCHASE' as any),
          eq(schema.bnplEvents.isAggregated, false),
          eq(schema.bnplEvents.status, 'PENDING' as any),
        ),
      );
    return Number(result[0]?.total || 0);
  }

  async findEventsByAccountIdAndPeriod(
    accountId: string,
    year: number,
    month: number,
  ): Promise<BnplEvent[]> {
    // 해당 월의 시작일과 종료일 계산 (UTC 기준)
    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

    return this.db.db.query.bnplEvents.findMany({
      where: and(
        eq(schema.bnplEvents.accountId, accountId),
        between(schema.bnplEvents.createdAt, startDate, endDate),
      ),
      orderBy: [desc(schema.bnplEvents.createdAt)],
    });
  }

  // ============================================
  // CMS Response 관련
  // ============================================

  async createCmsResponse(
    data: {
      batchId: string;
      accountId: string;
      eventId?: string;
      responseType: string;
      cmsResponseSnapshot: any;
      previousStatus?: string;
      newStatus: string;
      metadata?: any;
    },
    tx?: WalletExecutor,
  ): Promise<string> {
    const executor = tx || this.db.db;
    const [result] = await executor
      .insert(schema.bnplCmsResponses)
      .values({
        batchId: data.batchId,
        accountId: data.accountId,
        eventId: data.eventId ?? null,
        responseType: data.responseType,
        cmsResponseSnapshot: JSON.stringify(data.cmsResponseSnapshot),
        previousStatus: data.previousStatus ?? null,
        newStatus: data.newStatus,
        metadata: data.metadata ? JSON.stringify(data.metadata) : null,
      })
      .returning({ id: schema.bnplCmsResponses.id });

    this.logger.log(
      `CMS response recorded: ${result.id} for batch ${data.batchId}`,
    );
    return result.id;
  }

  async findCmsResponsesByBatchId(batchId: string) {
    return this.db.db.query.bnplCmsResponses.findMany({
      where: eq(schema.bnplCmsResponses.batchId, batchId),
      orderBy: [desc(schema.bnplCmsResponses.createdAt)],
    });
  }

  async findLatestCmsResponseByBatchId(batchId: string) {
    return this.db.db.query.bnplCmsResponses.findFirst({
      where: eq(schema.bnplCmsResponses.batchId, batchId),
      orderBy: [desc(schema.bnplCmsResponses.createdAt)],
    });
  }
}
