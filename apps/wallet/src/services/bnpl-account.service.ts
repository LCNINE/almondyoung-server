import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { walletSchema } from '../shared/database/schema';
import { eq, and, lte, gte, desc, sum, SQL, inArray } from 'drizzle-orm';

import {
  NewBnplAccount,
  NewBnplEvent,
  BnplAccount,
  BnplEvent,
} from '../shared/database/types';
import { generateUUIDv7 } from '../shared/utils/id-generator';
import { getTsid } from 'tsid-ts';
import {
  BnplEventCategory,
  BnplEventType,
  WalletExecutor,
} from '../shared/database';

/**
 * BnplAccountService - BNPL 계정 및 이벤트 관리
 *
 * 책임:
 * - BNPL 계정 생성 및 한도 관리
 * - 신용 사용/상환 이벤트 생성
 * - 배치 출금 대상 조회
 * - 한도 차감/복원 로직
 */
@Injectable()
export class BnplAccountService {
  private readonly logger = new Logger(BnplAccountService.name);

  constructor(private readonly db: DbService<typeof walletSchema>) {}

  /**
   * BNPL 계정을 생성합니다.
   * @param userId 사용자 ID
   * @param creditLimit 신용 한도
   * @param tx 트랜잭션 객체 (선택사항)
   * @returns 생성된 BNPL 계정
   */
  async createBnplAccount(
    userId: string,
    creditLimit: number,
    tx?: WalletExecutor,
  ): Promise<BnplAccount> {
    const executor = tx || this.db.db;

    try {
      // 중복 계정 검사
      const existing = await executor.query.bnplAccounts.findFirst({
        where: eq(schema.bnplAccounts.userId, userId),
      });

      if (existing) {
        throw new Error(`BNPL account already exists for user: ${userId}`);
      }

      // 다음 결제일 계산 (30일 후)
      const nextBillingDate = this.calculateNextBillingDate(new Date());
      const billingCycleStart = new Date().toISOString().split('T')[0];
      const billingCycleEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];

      const newAccount: NewBnplAccount = {
        id: getTsid().toString(),
        userId,
        creditLimit,
        availableLimit: creditLimit, // 초기에는 전체 한도가 사용 가능
        status: 'ACTIVE',
        billingCycleStart,
        billingCycleEnd,
        nextBillingDate,
      };

      this.logger.log(
        `Creating BNPL account with data: ${JSON.stringify(newAccount)}`,
      );

      const [createdAccount] = await executor
        .insert(schema.bnplAccounts)
        .values(newAccount)
        .returning();

      this.logger.log(
        `BNPL account created: ${createdAccount.id} for user ${userId}, limit: ${creditLimit}`,
      );

      return createdAccount;
    } catch (error) {
      this.logger.error(
        `Failed to create BNPL account: ${error.message}`,
        error.stack,
      );
      this.logger.error(`Full error object:`, error);
      if (error.cause) {
        this.logger.error(`Error cause:`, error.cause);
      }
      throw new Error(`BNPL account creation failed: ${error.message}`);
    }
  }

  /**
   * 신용 사용 이벤트를 생성하고 한도를 차감합니다.
   * @param userId 사용자 ID
   * @param amount 사용 금액
   * @param externalOrderId 외부 주문 ID
   * @param paymentIntentId 결제 Intent ID
   * @param tx 트랜잭션 객체 (선택사항)
   * @returns 생성된 이벤트
   */
  async createCreditEvent(
    userId: string,
    amount: number,
    externalOrderId: string,
    paymentIntentId: string,
    tx?: WalletExecutor,
  ): Promise<BnplEvent> {
    const executor = tx || this.db.db;

    try {
      // BNPL 계정 조회
      const account = await executor.query.bnplAccounts.findFirst({
        where: eq(schema.bnplAccounts.userId, userId),
      });

      if (!account) {
        throw new Error(`BNPL account not found for user: ${userId}`);
      }

      if (account.status !== ('ACTIVE' as any)) {
        throw new Error(`BNPL account is not active: ${account.status}`);
      }

      // 사용 가능 한도 확인
      if (account.availableLimit < amount) {
        throw new Error(
          `Insufficient BNPL limit: available ${account.availableLimit}, required ${amount}`,
        );
      }

      // 집계 기간 계산 (YYYY-MM 형식)
      const aggregationPeriod = new Date().toISOString().slice(0, 7);

      // 신용 사용 이벤트 생성
      const newEvent: NewBnplEvent = {
        id: getTsid().toString(),
        accountId: account.id,
        eventType:
          'PURCHASE' as (typeof schema.bnplEventTypeEnum.enumValues)[number],
        eventCategory:
          'CREDIT' as (typeof schema.bnplEventCategoryEnum.enumValues)[number],
        amount,
        externalOrderId,
        paymentIntentId,
        aggregationPeriod,
        isAggregated: false,
        status: 'PENDING', // 'PENDIN G'
        actor: 'SYSTEM',
      };

      const [createdEvent] = await executor
        .insert(schema.bnplEvents)
        .values(newEvent)
        .returning();

      // BnplEventDetails 테이블에도 상세 정보 삽입
      const newEventDetail: any = {
        id: getTsid().toString(),
        eventId: createdEvent.id,
        accountId: account.id,
        eventType: 'PURCHASE',
        amount,
        purchaseEventDetailId: null, // 구매 이벤트이므로 자기 참조는 나중에
        originalEventDetailId: null, // 원본 이벤트 참조
        balanceBefore: account.creditLimit - account.availableLimit, // 사용 중인 금액
        balanceAfter: account.creditLimit - account.availableLimit + amount, // 사용 후 금액
        availableBefore: account.availableLimit, // 사용 전 가용 한도
        availableAfter: account.availableLimit - amount, // 사용 후 가용 한도
      };

      const [createdEventDetail] = await executor
        .insert(schema.bnplEventDetails)
        .values(newEventDetail)
        .returning();

      // 구매 이벤트의 경우 자기 참조 설정
      await executor
        .update(schema.bnplEventDetails)
        .set({
          purchaseEventDetailId: createdEventDetail.id,
          originalEventDetailId: createdEventDetail.id,
        })
        .where(eq(schema.bnplEventDetails.id, createdEventDetail.id));

      // 사용 가능 한도 차감
      await executor
        .update(schema.bnplAccounts)
        .set({
          availableLimit: account.availableLimit - amount,
          updatedAt: new Date(),
        })
        .where(eq(schema.bnplAccounts.id, account.id));

      this.logger.log(
        `BNPL credit event created: ${createdEvent.id}, amount: ${amount}, remaining limit: ${account.availableLimit - amount}`,
      );

      return createdEvent;
    } catch (error) {
      this.logger.error(
        `Failed to create credit event: ${error.message}`,
        error.stack,
      );
      throw new Error(`BNPL credit event creation failed: ${error.message}`);
    }
  }

  /**
   * 상환 이벤트를 생성하고 한도를 복원합니다.
   * @param userId 사용자 ID
   * @param amount 상환 금액
   * @param batchTransactionId CMS 배치 거래 ID
   * @param aggregationPeriod 집계 기간
   * @param tx 트랜잭션 객체 (선택사항)
   * @returns 생성된 이벤트
   */
  async createDebitEvent(
    userId: string,
    amount: number,
    batchTransactionId: string,
    aggregationPeriod: string,
    tx?: WalletExecutor,
  ): Promise<BnplEvent> {
    const executor = tx || this.db.db;

    try {
      // BNPL 계정 조회
      const account = await executor.query.bnplAccounts.findFirst({
        where: eq(schema.bnplAccounts.userId, userId),
      });

      if (!account) {
        throw new Error(`BNPL account not found for user: ${userId}`);
      }

      // 상환 이벤트 생성
      const newEvent: NewBnplEvent = {
        id: getTsid().toString(),
        accountId: account.id,
        eventType: schema.bnplEventTypeEnum.enumValues.find(
          (v) => v === 'PAYMENT_SUCCESS',
        )!, // 결제 성공 이벤트
        eventCategory: schema.bnplEventCategoryEnum.enumValues.find(
          (v) => v === 'DEBIT',
        )!, // 한도 복원
        amount: -amount, // 상환은 음수로 기록
        aggregationPeriod,
        isAggregated: true,
        batchTransactionId,
        batchDueDate: new Date().toISOString().split('T')[0],
        status: schema.bnplEventStatusEnum.enumValues.find(
          (v) => v === 'COMPLETED',
        )!, // 'COMPLETED'
        actor: 'SYSTEM',
      };

      const [createdEvent] = await executor
        .insert(schema.bnplEvents)
        .values(newEvent)
        .returning();

      // 사용 가능 한도 복원
      await executor
        .update(schema.bnplAccounts)
        .set({
          availableLimit: account.availableLimit + amount,
          lastBilledAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.bnplAccounts.id, account.id));

      this.logger.log(
        `BNPL debit event created: ${createdEvent.id}, amount: ${amount}, restored limit: ${account.availableLimit + amount}`,
      );

      return createdEvent;
    } catch (error) {
      this.logger.error(
        `Failed to create debit event: ${error.message}`,
        error.stack,
      );
      throw new Error(`BNPL debit event creation failed: ${error.message}`);
    }
  }

  /**
   * 배치 출금 대상 계정들을 조회합니다.
   * @returns 출금 대상 계정 목록
   */
  async findAccountsForBilling(): Promise<BnplAccount[]> {
    try {
      const today = new Date().toISOString().split('T')[0];

      const accounts = await this.db.db.query.bnplAccounts.findMany({
        where: and(
          eq(schema.bnplAccounts.status, 'ACTIVE'),
          lte(schema.bnplAccounts.nextBillingDate, today),
        ),
        orderBy: [desc(schema.bnplAccounts.nextBillingDate)],
      });

      this.logger.log(`Found ${accounts.length} accounts for billing`);
      return accounts;
    } catch (error) {
      this.logger.error(
        `Failed to find accounts for billing: ${error.message}`,
        error.stack,
      );
      throw new Error(`Account billing lookup failed: ${error.message}`);
    }
  }

  /**
   * 특정 계정의 미정산 신용 사용 금액을 합산합니다.
   * @param accountId BNPL 계정 ID
   * @returns 미정산 총액
   */
  async getUnbilledAmount(accountId: string): Promise<number> {
    try {
      const result = await this.db.db
        .select({
          total: sum(schema.bnplEvents.amount),
        })
        .from(schema.bnplEvents)
        .where(
          and(
            eq(schema.bnplEvents.accountId, accountId),
            eq(schema.bnplEvents.eventType, 'PURCHASE' as any),
            eq(schema.bnplEvents.isAggregated, false),
            eq(schema.bnplEvents.status, 'PENDING' as any),
          ),
        );

      const unbilledAmount = Number(result[0]?.total || 0);

      this.logger.log(
        `Unbilled amount for account ${accountId}: ${unbilledAmount}`,
      );

      return unbilledAmount;
    } catch (error) {
      this.logger.error(
        `Failed to get unbilled amount: ${error.message}`,
        error.stack,
      );
      throw new Error(`Unbilled amount calculation failed: ${error.message}`);
    }
  }

  /**
   * 미정산 이벤트들을 배치로 표시합니다.
   * @param accountId BNPL 계정 ID
   * @param batchTransactionId CMS 배치 거래 ID
   * @param batchDueDate CMS 출금 신청일
   * @param tx 트랜잭션 객체 (선택사항)
   */
  async markEventsAsAggregated(
    accountId: string,
    batchTransactionId: string,
    batchDueDate: string,
    tx?: WalletExecutor,
  ): Promise<void> {
    const executor = tx || this.db.db;

    try {
      await executor
        .update(schema.bnplEvents)
        .set({
          isAggregated: true,
          batchTransactionId,
          batchDueDate,
          status: 'PENDING', // AGGREGATED는 enum에 없으므로 PENDING 사용
        })
        .where(
          and(
            eq(schema.bnplEvents.accountId, accountId),
            eq(schema.bnplEvents.eventCategory, 'CREDIT'),
            eq(schema.bnplEvents.isAggregated, false),
            eq(schema.bnplEvents.status, 'PENDING' as any),
          ),
        );

      this.logger.log(
        `Marked events as aggregated for account ${accountId}, batch: ${batchTransactionId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to mark events as aggregated: ${error.message}`,
        error.stack,
      );
      throw new Error(`Event aggregation failed: ${error.message}`);
    }
  }

  /**
   * 계정의 다음 결제일을 업데이트합니다.
   * @param accountId BNPL 계정 ID
   * @param tx 트랜잭션 객체 (선택사항)
   */
  async updateNextBillingDate(
    accountId: string,
    tx?: WalletExecutor,
  ): Promise<void> {
    const executor = tx || this.db.db;

    try {
      const nextBillingDate = this.calculateNextBillingDate(new Date());

      await executor
        .update(schema.bnplAccounts)
        .set({
          nextBillingDate,
          billingCycleStart: new Date().toISOString().split('T')[0],
          billingCycleEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            .toISOString()
            .split('T')[0],
          updatedAt: new Date(),
        })
        .where(eq(schema.bnplAccounts.id, accountId));

      this.logger.log(
        `Updated next billing date for account ${accountId}: ${nextBillingDate}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to update next billing date: ${error.message}`,
        error.stack,
      );
      throw new Error(`Billing date update failed: ${error.message}`);
    }
  }

  /**
   * CMS 응답 결과를 반영합니다.
   * @param batchTransactionId CMS 배치 거래 ID
   * @param cmsStatus CMS 상태
   * @param cmsErrorCode CMS 에러 코드 (선택사항)
   * @param cmsResponseSnapshot CMS 응답 스냅샷 (선택사항)
   * @param tx 트랜잭션 객체 (선택사항)
   */
  async updateCmsResponse(
    batchTransactionId: string,
    cmsStatus: string,
    cmsErrorCode?: string,
    cmsResponseSnapshot?: any,
    tx?: WalletExecutor,
  ): Promise<void> {
    const executor = tx || this.db.db;

    try {
      await executor
        .update(schema.bnplEvents)
        .set({
          cmsStatus,
          cmsErrorCode,
          cmsResponseSnapshot,
          status:
            cmsStatus === 'PROCESSED'
              ? ('COMPLETED' as any)
              : ('FAILED' as any),
        })
        .where(eq(schema.bnplEvents.batchTransactionId, batchTransactionId));

      this.logger.log(
        `Updated CMS response for batch ${batchTransactionId}: ${cmsStatus}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to update CMS response: ${error.message}`,
        error.stack,
      );
      throw new Error(`CMS response update failed: ${error.message}`);
    }
  }

  async failEventsByBatch(batchId: string, tx: WalletExecutor) {
    const events = await tx.query.bnplEvents.findMany({
      where: eq(schema.bnplEvents.batchTransactionId, batchId),
    });
    const ids = events.map((e) => e.id);
    if (ids.length === 0) return;

    await tx
      .update(schema.bnplEvents)
      .set({ status: 'FAILED' })
      .where(inArray(schema.bnplEvents.id, ids));
  }
  /**
   * 다음 결제일을 계산합니다 (30일 후 영업일).
   * @param baseDate 기준 날짜
   * @returns 다음 결제일 (YYYY-MM-DD)
   */
  private calculateNextBillingDate(baseDate: Date): string {
    // 30일 후 계산
    const nextDate = new Date(baseDate.getTime() + 30 * 24 * 60 * 60 * 1000);

    // 주말이면 다음 월요일로 조정
    const dayOfWeek = nextDate.getDay();
    if (dayOfWeek === 0) {
      // 일요일
      nextDate.setDate(nextDate.getDate() + 1);
    } else if (dayOfWeek === 6) {
      // 토요일
      nextDate.setDate(nextDate.getDate() + 2);
    }

    return nextDate.toISOString().split('T')[0];
  }

  /**
   * 사용자 ID로 BNPL 계정을 조회합니다.
   * @param userId 사용자 ID
   * @returns BNPL 계정 또는 null
   */
  async findAccountByUserId(userId: string): Promise<BnplAccount | null> {
    try {
      const account = await this.db.db.query.bnplAccounts.findFirst({
        where: eq(schema.bnplAccounts.userId, userId),
      });

      return account ?? null;
    } catch (error) {
      this.logger.error(
        `Failed to find BNPL account: ${error.message}`,
        error.stack,
      );
      throw new Error(`BNPL account lookup failed: ${error.message}`);
    }
  }
}
