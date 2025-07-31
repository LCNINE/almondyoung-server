import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDb, DbService } from '@app/db';
import * as schema from '../../shared/schemas/schema';
import { BnplPaymentMethodRegisteredEvent } from '../../payment-method/events/bnpl-payment-method-registered.event';
import { newMemberId, FINANCIAL_TRANSACTION_STATUS } from '../../shared/schemas/schema';
import { ulid } from 'ulid';
import { eq, desc, and, count, inArray, sql } from 'drizzle-orm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  BnplAccountCreatedEvent,
  BnplCreditUsedEvent,
  BnplCreditRestoredEvent,
  BnplCreditLimitChangedEvent,
  BnplAccountStatusChangedEvent,
} from '../events/bnpl.events';
@Injectable()
export class BnplAccountService {
  private readonly logger = new Logger(BnplAccountService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
    private readonly eventEmitter: EventEmitter2,
  ) { }

  async createFromEvent(
    event: BnplPaymentMethodRegisteredEvent,
  ): Promise<void> {
    this.logger.log(
      `이벤트 수신: ${event.userId}에 대한 BNPL 계정 생성을 시도합니다.`,
    );

    try {
      await this.dbService.db.transaction(async (tx) => {
        // 1. ✅ 해당 userId로 BNPL 계정이 이미 존재하는지 먼저 확인합니다.
        const existingAccount = await tx.query.bnplAccount.findFirst({
          where: eq(schema.bnplAccount.userId, event.userId),
        });

        // 2. ✅ 이미 계정이 있다면, 아무것도 하지 않고 함수를 종료합니다.
        if (existingAccount) {
          this.logger.log(
            `사용자 ${event.userId}의 BNPL 계정이 이미 존재하므로 생성을 건너뜁니다. Account ID: ${existingAccount.id}`,
          );
          // TODO: 필요하다면, 기존 계정에 새로운 paymentMethodId를 연결하는 로직을 추가할 수 있습니다.
          return;
        }

        // 3. ✅ 계정이 없을 때만 새로 생성하는 로직을 실행합니다.
        const [newAccount] = await tx
          .insert(schema.bnplAccount)
          .values({
            id: newMemberId(),
            userId: event.userId,
            paymentMethodId: event.paymentMethodId,
            creditLimit: event.creditLimit,
            approvedLimit: event.approvedLimit,
            billingCycleDay: event.billingCycleDay,
            status: 'ACTIVE',
          })
          .returning();

        this.logger.log(`BNPL 계정 생성 완료: ${newAccount.id}`);

        await tx.insert(schema.bnplActivationEvent).values({
          id: ulid(),
          paymentMethodId: newAccount.paymentMethodId,
          bnplAccountId: newAccount.id,
          eventType: 'ACTIVATED',
          actor: 'SYSTEM',
        });

        this.logger.log(
          `BNPL 활성화 이벤트 기록 완료: BNPL Account ID ${newAccount.id}`,
        );

        // 🎯 BNPL 계정 생성 이벤트 발행 (Event Sourcing)
        this.eventEmitter.emit(
          'bnpl.account.created',
          new BnplAccountCreatedEvent(
            newAccount.id,
            event.userId,
            Number(newAccount.approvedLimit),
          ),
        );
      });
    } catch (error) {
      this.logger.error(
        `${event.paymentMethodId}에 대한 BNPL 계정 생성 트랜잭션 실패`,
        error,
      );
    }
  }

  /**
   * 사용자의 현재 사용 가능한 BNPL 신용 한도를 계산합니다.
   * @param userId 사용자 ID
   * @param emitEvents 이벤트 발행 여부 (기본값: false)
   * @param transactionId 거래 ID (이벤트 발행 시 필요)
   * @param usedAmount 사용 금액 (이벤트 발행 시 필요)
   */
  async getAvailableCredit(
    userId: string,
    emitEvents: boolean = false,
    transactionId?: string,
    usedAmount?: number,
  ): Promise<number> {
    // 1. 사용자의 BNPL 계정 정보를 가져옵니다.
    const bnplAccount = await this.dbService.db.query.bnplAccount.findFirst({
      where: eq(schema.bnplAccount.userId, userId),
    });

    if (!bnplAccount) {
      throw new NotFoundException('BNPL 계정을 찾을 수 없습니다.');
    }

    const approvedLimit = Number(bnplAccount.approvedLimit);

    // 2. 아직 정산되지 않은 모든 거래(현재 사용액)를 합산합니다.
    const result = await this.dbService.db
      .select({
        totalUsage: sql<number>`sum(${schema.bnplTransaction.amount})`.mapWith(Number),
      })
      .from(schema.bnplTransaction)
      .where(
        and(
          eq(schema.bnplTransaction.bnplAccountId, bnplAccount.id),
          // 정산 요청되었거나, 내부 승인만 된 거래들이 현재 사용액에 해당합니다.
          inArray(schema.bnplTransaction.status, [
            FINANCIAL_TRANSACTION_STATUS.AUTHORIZED,
            FINANCIAL_TRANSACTION_STATUS.SETTLEMENT_REQUESTED
          ]),
        ),
      );

    const currentUsage = result[0]?.totalUsage || 0;

    // 3. 사용 가능 한도를 계산하여 반환합니다.
    const availableCredit = approvedLimit - currentUsage;

    this.logger.log(`사용자 ${userId} 사용 가능 한도: ${availableCredit} (총 한도: ${approvedLimit}, 사용액: ${currentUsage})`);

    // 4. 이벤트 발행 (요청 시)
    if (emitEvents && transactionId && usedAmount !== undefined) {
      // 🎯 신용 한도 사용 이벤트 발행 (Event Sourcing)
      this.eventEmitter.emit(
        'bnpl.credit.used',
        new BnplCreditUsedEvent(
          bnplAccount.id,
          userId,
          transactionId,
          usedAmount,
          availableCredit,
        ),
      );
    }

    return availableCredit;
  }

  /**
   * 신용 한도 복원 이벤트를 발행합니다.
   * 정산 완료 후 호출됩니다.
   */
  async restoreCredit(userId: string, transactionId: string, amount: number): Promise<void> {
    // 1. 사용자의 BNPL 계정 정보를 가져옵니다.
    const bnplAccount = await this.dbService.db.query.bnplAccount.findFirst({
      where: eq(schema.bnplAccount.userId, userId),
    });

    if (!bnplAccount) {
      throw new NotFoundException('BNPL 계정을 찾을 수 없습니다.');
    }

    // 2. 현재 가용 한도를 계산합니다.
    const availableCredit = await this.getAvailableCredit(userId);
    const newAvailableCredit = availableCredit + amount;

    // 3. 신용 한도 복원 이벤트 발행
    this.eventEmitter.emit(
      'bnpl.credit.restored',
      new BnplCreditRestoredEvent(
        bnplAccount.id,
        userId,
        transactionId,
        amount,
        newAvailableCredit,
      ),
    );

    this.logger.log(`사용자 ${userId} 신용 한도 복원: ${amount}원 (새 가용한도: ${newAvailableCredit}원)`);
  }

  /**
   * 신용 한도를 변경하고 이벤트를 발행합니다.
   * 관리자 요청에 의해 호출됩니다.
   */
  async updateCreditLimit(
    userId: string,
    newLimit: number,
    reason: string,
    changedBy: string,
  ): Promise<void> {
    // 1. 사용자의 BNPL 계정 정보를 가져옵니다.
    const bnplAccount = await this.dbService.db.query.bnplAccount.findFirst({
      where: eq(schema.bnplAccount.userId, userId),
    });

    if (!bnplAccount) {
      throw new NotFoundException('BNPL 계정을 찾을 수 없습니다.');
    }

    const oldLimit = Number(bnplAccount.approvedLimit);

    // 2. 한도 변경
    await this.dbService.db
      .update(schema.bnplAccount)
      .set({
        approvedLimit: newLimit,
        updatedAt: new Date(),
      })
      .where(eq(schema.bnplAccount.id, bnplAccount.id));

    // 3. 신용 한도 변경 이벤트 발행
    this.eventEmitter.emit(
      'bnpl.credit.limit.changed',
      new BnplCreditLimitChangedEvent(
        bnplAccount.id,
        userId,
        oldLimit,
        newLimit,
        reason,
        changedBy,
      ),
    );

    this.logger.log(`사용자 ${userId} 신용 한도 변경: ${oldLimit}원 → ${newLimit}원 (사유: ${reason})`);
  }

  /**
   * 계정 상태를 변경하고 이벤트를 발행합니다.
   * 관리자 요청에 의해 호출됩니다.
   */
  async updateAccountStatus(
    userId: string,
    newStatus: schema.BnplAccountStatus,
    reason: string,
    changedBy: string,
  ): Promise<void> {
    // 1. 사용자의 BNPL 계정 정보를 가져옵니다.
    const bnplAccount = await this.dbService.db.query.bnplAccount.findFirst({
      where: eq(schema.bnplAccount.userId, userId),
    });

    if (!bnplAccount) {
      throw new NotFoundException('BNPL 계정을 찾을 수 없습니다.');
    }

    const oldStatus = bnplAccount.status;

    // 2. 상태 변경
    await this.dbService.db
      .update(schema.bnplAccount)
      .set({
        status: newStatus,
        updatedAt: new Date(),
      })
      .where(eq(schema.bnplAccount.id, bnplAccount.id));

    // 3. 계정 상태 변경 이벤트 발행
    this.eventEmitter.emit(
      'bnpl.account.status.changed',
      new BnplAccountStatusChangedEvent(
        bnplAccount.id,
        userId,
        oldStatus,
        newStatus,
        reason,
        changedBy,
      ),
    );

    this.logger.log(`사용자 ${userId} 계정 상태 변경: ${oldStatus} → ${newStatus} (사유: ${reason})`);
  }

  /**
   * 사용자의 BNPL 계정 정보를 조회합니다.
   */
  async getMyBnplAccount(userId: string) {
    const bnplAccount = await this.dbService.db.query.bnplAccount.findFirst({
      where: eq(schema.bnplAccount.userId, userId),
      with: {
        activationEvents: {
          orderBy: desc(schema.bnplActivationEvent.createdAt),
          limit: 1, // 최신 활성화 이벤트만
        },
      },
    });

    if (!bnplAccount) {
      throw new NotFoundException('BNPL 계정을 찾을 수 없습니다.');
    }

    return {
      id: bnplAccount.id,
      userId: bnplAccount.userId,
      status: bnplAccount.status,
      creditLimit: bnplAccount.creditLimit,
      approvedLimit: bnplAccount.approvedLimit,
      billingCycleDay: bnplAccount.billingCycleDay,
      createdAt: bnplAccount.createdAt,
      updatedAt: bnplAccount.updatedAt,
      latestActivation: bnplAccount.activationEvents[0] || null,
    };
  }

  /**
   * 사용자의 BNPL 거래 내역을 페이징하여 조회합니다.
   */
  async getMyTransactions(userId: string, limit: number, offset: number) {
    // 먼저 사용자의 BNPL 계정 확인
    const bnplAccount = await this.dbService.db.query.bnplAccount.findFirst({
      where: eq(schema.bnplAccount.userId, userId),
    });

    if (!bnplAccount) {
      throw new NotFoundException('BNPL 계정을 찾을 수 없습니다.');
    }

    // 거래 내역 조회 (PaymentSession 기반)
    const transactions = await this.dbService.db.query.bnplTransaction.findMany({
      where: eq(schema.bnplTransaction.bnplAccountId, bnplAccount.id),
      orderBy: desc(schema.bnplTransaction.createdAt),
      limit,
      offset,
      // PaymentSession 관계는 순환 참조 문제로 인해 제거되었으므로 별도 조회
    });

    // count() 함수를 사용하여 전체 거래 수 조회
    const totalResult = await this.dbService.db
      .select({ total: count() })
      .from(schema.bnplTransaction)
      .where(eq(schema.bnplTransaction.bnplAccountId, bnplAccount.id));

    // PaymentSession 정보를 별도로 조회 (필요한 경우)
    const transactionsWithPaymentSession = await Promise.all(
      transactions.map(async (tx) => {
        // PaymentSession 정보 별도 조회
        const paymentSession = await this.dbService.db.query.paymentSessions.findFirst({
          where: eq(schema.paymentSessions.id, tx.paymentSessionId),
          columns: {
            id: true,
            amount: true,
            platform: true,
            status: true,
            createdAt: true,
          },
        });

        return {
          id: tx.id,
          transactionType: tx.transactionType,
          status: tx.status,
          amount: tx.amount,
          createdAt: tx.createdAt,
          paymentSession: paymentSession,
        };
      })
    );

    return {
      transactions: transactionsWithPaymentSession,
      total: totalResult[0].total
    };
  }

  /**
   * 사용자의 정산 배치 내역을 조회합니다.
   */
  async getMySettlements(userId: string) {
    // 먼저 사용자의 BNPL 계정 확인
    const bnplAccount = await this.dbService.db.query.bnplAccount.findFirst({
      where: eq(schema.bnplAccount.userId, userId),
    });

    if (!bnplAccount) {
      throw new NotFoundException('BNPL 계정을 찾을 수 없습니다.');
    }

    // 정산 배치 내역 조회 (PaymentSession 기반)
    const settlements = await this.dbService.db.query.settlementBatch.findMany({
      where: eq(schema.settlementBatch.bnplAccountId, bnplAccount.id),
      orderBy: desc(schema.settlementBatch.createdAt),
      with: {
        items: {
          with: {
            bnplTransaction: true, // PaymentSession 관계는 별도 조회
          },
        },
      },
    });

    return settlements.map(settlement => ({
      id: settlement.id,
      batchNumber: settlement.batchNumber,
      totalAmount: settlement.totalAmount,
      status: settlement.status,
      dueDate: settlement.dueDate,
      batchPeriodStart: settlement.batchPeriodStart,
      batchPeriodEnd: settlement.batchPeriodEnd,
      createdAt: settlement.createdAt,
      transactionCount: settlement.items?.length || 0,
      transactions: settlement.items?.map(item => ({
        id: item.bnplTransaction.id,
        amount: item.bnplTransaction.amount,
        paymentSessionId: item.bnplTransaction.paymentSessionId, // PaymentSession ID 참조
      })) || [],
    }));
  }

  /**
   * 특정 정산 배치의 상세 정보를 조회합니다. (소유권 확인 포함)
   */
  async getSettlementDetail(userId: string, batchId: string) {
    // 먼저 사용자의 BNPL 계정 확인
    const bnplAccount = await this.dbService.db.query.bnplAccount.findFirst({
      where: eq(schema.bnplAccount.userId, userId),
    });

    if (!bnplAccount) {
      throw new NotFoundException('BNPL 계정을 찾을 수 없습니다.');
    }

    // 정산 배치 상세 조회 (본인 소유 확인)
    const settlement = await this.dbService.db.query.settlementBatch.findFirst({
      where: and(
        eq(schema.settlementBatch.id, batchId),
        eq(schema.settlementBatch.bnplAccountId, bnplAccount.id),
      ),
      with: {
        items: {
          with: {
            bnplTransaction: true, // PaymentSession 관계는 별도 조회
          },
        },
      },
    });

    if (!settlement) {
      throw new NotFoundException('정산 배치를 찾을 수 없거나 권한이 없습니다.');
    }

    return {
      id: settlement.id,
      batchNumber: settlement.batchNumber,
      totalAmount: settlement.totalAmount,
      status: settlement.status,
      dueDate: settlement.dueDate,
      batchPeriodStart: settlement.batchPeriodStart,
      batchPeriodEnd: settlement.batchPeriodEnd,
      createdAt: settlement.createdAt,
      updatedAt: settlement.updatedAt,
      transactions: settlement.items?.map(item => ({
        id: item.bnplTransaction.id,
        transactionType: item.bnplTransaction.transactionType,
        status: item.bnplTransaction.status,
        amount: item.bnplTransaction.amount,
        createdAt: item.bnplTransaction.createdAt,
        paymentSessionId: item.bnplTransaction.paymentSessionId, // PaymentSession ID 참조
      })) || [],
    };
  }
}
