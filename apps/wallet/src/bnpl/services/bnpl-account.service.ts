import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDb, DbService } from '@app/db';
import * as schema from '../../shared/schemas/schema';
import { BnplPaymentMethodRegisteredEvent } from '../../payment-method/events/bnpl-payment-method-registered.event';
import { newMemberId } from '../../shared/schemas/schema';
import { ulid } from 'ulid';
import { eq, desc, and, count } from 'drizzle-orm';

@Injectable()
export class BnplAccountService {
  private readonly logger = new Logger(BnplAccountService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
  ) {}

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
      });
    } catch (error) {
      this.logger.error(
        `${event.paymentMethodId}에 대한 BNPL 계정 생성 트랜잭션 실패`,
        error,
      );
    }
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

    // 거래 내역 조회
    const transactions = await this.dbService.db.query.bnplTransaction.findMany({
      where: eq(schema.bnplTransaction.bnplAccountId, bnplAccount.id),
      orderBy: desc(schema.bnplTransaction.createdAt),
      limit,
      offset,
      with: {
        invoice: {
          columns: {
            id: true,
            amount: true,
            invoiceType: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });

    // count() 함수를 사용하여 전체 거래 수 조회
    const totalResult = await this.dbService.db
      .select({ total: count() })
      .from(schema.bnplTransaction)
      .where(eq(schema.bnplTransaction.bnplAccountId, bnplAccount.id));

    return { 
      transactions: transactions.map(tx => ({
        id: tx.id,
        transactionType: tx.transactionType,
        status: tx.status,
        amount: tx.amount,
        createdAt: tx.createdAt,
        invoice: tx.invoice,
      })),
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

    // 정산 배치 내역 조회
    const settlements = await this.dbService.db.query.settlementBatch.findMany({
      where: eq(schema.settlementBatch.bnplAccountId, bnplAccount.id),
      orderBy: desc(schema.settlementBatch.createdAt),
      with: {
        items: {
          with: {
            bnplTransaction: {
              with: {
                invoice: {
                  columns: {
                    id: true,
                    invoiceType: true,
                    amount: true,
                  },
                },
              },
            },
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
        invoice: item.bnplTransaction.invoice,
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
            bnplTransaction: {
              with: {
                invoice: true,
              },
            },
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
        invoice: {
          id: item.bnplTransaction.invoice.id,
          invoiceType: item.bnplTransaction.invoice.invoiceType,
          amount: item.bnplTransaction.invoice.amount,
          status: item.bnplTransaction.invoice.status,
          createdAt: item.bnplTransaction.invoice.createdAt,
        },
      })) || [],
    };
  }
}
