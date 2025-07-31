import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDb, DbService } from '@app/db';
import * as schema from '../shared/schemas/schema';
import {
  FINANCIAL_TRANSACTION_STATUS,
  BATCH_JOB_STATUS,
  PAYMENT_SESSION_STATUS,
} from '../shared/schemas/schema';
import { eq, inArray } from 'drizzle-orm';
import { ulid } from 'ulid';
import { PaymentProcessingPort } from './port/payment-processing.port';
import { PaymentService } from './payment.service';
import { WalletTx } from '../shared/types';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  InvoicePaidEvent,
  InvoiceFailedEvent,
} from '../invoice/events/invoice.events';
import {
  PaymentCapturedEvent,
  PaymentFailedEvent,
  SettlementBatchStartedEvent,
  SettlementBatchCompletedEvent,
} from './events/payment.events';
import {
  SettlementBatchCreatedEvent,
  SettlementBatchFailedEvent,
  SettlementBatchItemAddedEvent,
} from './events/settlement.events';

// 타입 정의
interface BnplTransactionWithAccount {
  id: string;
  bnplAccountId: string;
  paymentSessionId: string;
  amount: number;
  createdAt: Date;
  bnplAccount: {
    userId: string;
  };
}

interface UserGroup {
  userId: string;
  bnplAccountId: string;
  totalAmount: number;
  transactions: BnplTransactionWithAccount[];
}

interface BatchItem {
  bnplTransaction: BnplTransactionWithAccount;
}

interface SettlementBatchWithItems {
  id: string;
  bnplAccountId: string;
  totalAmount: number;
  pgTransactionId: string | null;
  items: BatchItem[];
}

interface PaymentStatusResult {
  status: string;
  [key: string]: any;
}

/**
 * 정산(Settlement) 도메인 서비스
 * 
 * 이 서비스는 BNPL 결제의 실제 출금을 담당합니다.
 * 월말 배치로 사용자별 거래를 합산하여 PG사에 출금을 요청하고,
 * 성공 시에만 Invoice를 PAID 상태로 변경합니다.
 * 
 * 아키텍처 원칙:
 * 1. 배치 처리: 사용자별로 거래를 그룹화하여 효율적으로 처리
 * 2. 상태 관리: 실제 돈을 받은 후에만 Invoice를 PAID로 변경
 * 3. 신용 한도 복원: CAPTURED 상태가 되면 사용자의 신용 한도가 자동 복원
 */
@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    @Inject(PaymentProcessingPort)
    private readonly paymentProcessor: PaymentProcessingPort,
    @InjectDb() private readonly dbService: DbService<typeof schema>,
    private readonly paymentService: PaymentService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * 월말 정산 배치 생성 (테스트 환경: 1분마다 실행)
   * 사용자별로 AUTHORIZED 거래를 그룹화하고 합산하여 월 1회 PG사에 배치 출금 요청
   */
  @Cron('0 * * * * *', {
    name: 'settlement-batch-test',
    timeZone: 'Asia/Seoul',
  })
  async createMonthlySettlementBatch() {
    this.logger.log('[정산 배치] 월말 정산 배치 생성 시작');
    try {
      await this.dbService.db.transaction(async (tx) => {
        // 1. 'AUTHORIZED' 상태인 모든 bnplTransaction 조회 (정산 대상 선정)
        const pendingTransactions = await tx.query.bnplTransaction.findMany({
          where: eq(
            schema.bnplTransaction.status,
            FINANCIAL_TRANSACTION_STATUS.AUTHORIZED,
          ),
          with: {
            bnplAccount: true, // userId를 얻기 위함
          },
        });

        if (pendingTransactions.length === 0) {
          this.logger.log('[정산 배치] 정산할 거래가 없습니다.');
          return;
        }

        this.logger.log(
          `[정산 배치] ${pendingTransactions.length}건의 거래에 대한 정산 처리 시작`,
        );

        // 2. 사용자별로 그룹화하여 정산 배치 생성
        const userGroups = this.groupTransactionsByUser(pendingTransactions);

        for (const userGroup of userGroups) {
          await this.processUserBatchSettlement(tx, userGroup);
        }

        this.logger.log('[정산 배치] 월말 정산 배치 생성 완료');
      });
    } catch (error) {
      this.logger.error('[정산 배치] 월말 정산 배치 생성 중 오류 발생', error);
    }
  }

  /**
   * 거래를 사용자별로 그룹화하는 헬퍼 메서드
   */
  private groupTransactionsByUser(transactions: BnplTransactionWithAccount[]) {
    const userMap = new Map<string, UserGroup>();

    for (const transaction of transactions) {
      const userId = transaction.bnplAccount.userId;
      const bnplAccountId = transaction.bnplAccountId;

      if (!userMap.has(userId)) {
        userMap.set(userId, {
          userId,
          bnplAccountId,
          totalAmount: 0,
          transactions: [],
        });
      }

      const userGroup = userMap.get(userId)!;
      userGroup.totalAmount += Number(transaction.amount);
      userGroup.transactions.push(transaction);
    }

    return Array.from(userMap.values());
  }

  /**
   * 사용자별 배치 정산을 처리하는 헬퍼 메서드
   * 사용자의 모든 거래를 합산하여 1회 PG사에 출금 요청
   */
  private async processUserBatchSettlement(tx: WalletTx, userGroup: UserGroup) {
    try {
      // 사용자별 정산 배치 생성 (내부 회계용)
      const now = new Date();
      const yearMonth = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}`;

      const [settlementBatch] = await tx
        .insert(schema.settlementBatch)
        .values({
          bnplAccountId: userGroup.bnplAccountId,
          batchNumber: `BATCH_${yearMonth}_${userGroup.userId}`,
          totalAmount: userGroup.totalAmount,
          dueDate: new Date(now.getFullYear(), now.getMonth() + 1, 15),
          status: BATCH_JOB_STATUS.PROCESSING,
          batchPeriodStart: new Date(now.getFullYear(), now.getMonth(), 1),
          batchPeriodEnd: new Date(now.getFullYear(), now.getMonth() + 1, 0),
        })
        .returning();

      this.logger.log(
        `[정산 배치] 사용자 ${userGroup.userId} 정산 배치 생성: ${settlementBatch.id}, 총액: ${userGroup.totalAmount}원`,
      );

      // 정산 배치 생성 이벤트 발행
      this.eventEmitter.emit(
        'settlement.batch.created',
        new SettlementBatchCreatedEvent(
          settlementBatch.id,
          userGroup.bnplAccountId,
          settlementBatch.batchNumber,
          userGroup.totalAmount,
          userGroup.transactions.length,
          settlementBatch.dueDate,
        ),
      );

      // 사용자의 결제수단 정보 조회
      const paymentMethod = await tx.query.paymentMethod.findFirst({
        where: eq(schema.paymentMethod.userId, userGroup.userId),
        with: { batchCms: true },
      });

      if (!paymentMethod?.batchCms) {
        throw new Error(`사용자 ${userGroup.userId}의 BatchCMS 정보 없음`);
      }

      // 사용자별 총액으로 1회 PG사에 배치 출금 요청
      this.logger.log(
        `[정산 배치] HMS API 호출 시작: memberId=${paymentMethod.batchCms.hmsMemberId}, amount=${userGroup.totalAmount}`,
      );

      const chargeResult = await this.paymentProcessor.charge({
        memberId: paymentMethod.batchCms.hmsMemberId,
        amount: userGroup.totalAmount,
        invoiceId: `BATCH_${settlementBatch.id}`,
        paymentDate: this.calculateNextSettlementDate(),
      });

      if (chargeResult.success) {
        this.logger.log(
          `[정산 배치] HMS API 응답: success=true, transactionId=${chargeResult.transactionId}`,
        );
        
        // pgTransactionId를 settlementBatch 테이블에 저장
        await tx
          .update(schema.settlementBatch)
          .set({
            pgTransactionId: chargeResult.transactionId,
            status: BATCH_JOB_STATUS.PROCESSING,
            updatedAt: new Date(),
          })
          .where(eq(schema.settlementBatch.id, settlementBatch.id));

        // 모든 관련 거래들을 SETTLEMENT_REQUESTED 상태로 업데이트
        for (const transaction of userGroup.transactions) {
          await tx
            .update(schema.bnplTransaction)
            .set({ status: FINANCIAL_TRANSACTION_STATUS.SETTLEMENT_REQUESTED })
            .where(eq(schema.bnplTransaction.id, transaction.id));

          // 거래를 배치에 연결 (settlementBatchItem 생성)
          await tx.insert(schema.settlementBatchItem).values({
            id: ulid(),
            batchId: settlementBatch.id,
            bnplTransactionId: transaction.id,
            amount: transaction.amount,
            transactionDate: transaction.createdAt,
          });

          // 정산 배치 아이템 추가 이벤트 발행
          this.eventEmitter.emit(
            'settlement.batch.item.added',
            new SettlementBatchItemAddedEvent(
              settlementBatch.id,
              transaction.id,
              Number(transaction.amount),
            ),
          );

          // PaymentEvents의 pgTransactionId도 업데이트
          await tx
            .update(schema.paymentEvents)
            .set({ 
              pgTransactionId: chargeResult.transactionId,
              status: FINANCIAL_TRANSACTION_STATUS.SETTLEMENT_REQUESTED,
              updatedAt: new Date(),
            })
            .where(eq(schema.paymentEvents.paymentSessionId, transaction.paymentSessionId));
        }

        // 정산 배치 시작 이벤트 발행
        this.eventEmitter.emit(
          'settlement.batch.started',
          new SettlementBatchStartedEvent(
            settlementBatch.id,
            userGroup.bnplAccountId,
            userGroup.totalAmount,
            userGroup.transactions.length,
            new Date(),
          ),
        );

        this.logger.log(
          `[정산 배치] 사용자 ${userGroup.userId} 배치 정산 요청 성공: pgTransactionId=${chargeResult.transactionId}`,
        );
      } else {
        // PG사 배치 요청 실패 시 처리
        await tx
          .update(schema.settlementBatch)
          .set({
            status: BATCH_JOB_STATUS.FAILED,
            updatedAt: new Date(),
          })
          .where(eq(schema.settlementBatch.id, settlementBatch.id));

        // 모든 관련 거래들을 FAILED 상태로 업데이트
        for (const transaction of userGroup.transactions) {
          await tx
            .update(schema.bnplTransaction)
            .set({ status: FINANCIAL_TRANSACTION_STATUS.FAILED })
            .where(eq(schema.bnplTransaction.id, transaction.id));

          // PaymentEvents도 FAILED로 업데이트
          await tx
            .update(schema.paymentEvents)
            .set({ 
              status: FINANCIAL_TRANSACTION_STATUS.FAILED,
              updatedAt: new Date(),
            })
            .where(eq(schema.paymentEvents.paymentSessionId, transaction.paymentSessionId));

          // PaymentSession을 FAILED 상태로 변경
          await tx
            .update(schema.paymentSessions)
            .set({
              status: PAYMENT_SESSION_STATUS.FAILED,
              updatedAt: new Date(),
            })
            .where(eq(schema.paymentSessions.id, transaction.paymentSessionId));
        }

        // 정산 배치 실패 이벤트 발행
        const errorMessage = 'error' in chargeResult ? chargeResult.error : '알 수 없는 오류';
        this.eventEmitter.emit(
          'settlement.batch.failed',
          new SettlementBatchFailedEvent(
            settlementBatch.id,
            userGroup.bnplAccountId,
            userGroup.totalAmount,
            errorMessage,
          ),
        );

        if ('error' in chargeResult) {
          this.logger.error(
            `[정산 배치] 사용자 ${userGroup.userId} 배치 정산 요청 실패: ${chargeResult.error}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `[정산 배치] 사용자 ${userGroup.userId} 배치 정산 처리 중 오류:`,
        error,
      );
    }
  }

  /**
   * 정산 결과 확인 (테스트 환경: 1분 30초마다 실행)
   * 'PROCESSING' 상태인 배치들의 최종 결과를 PG사에서 확인
   */
  @Cron('30 * * * * *', {
    name: 'check-settlement-results-test',
    timeZone: 'Asia/Seoul',
  })
  async checkSettlementResults() {
    this.logger.log('[정산 확인] 정산 결과 확인 시작');

    try {
      await this.dbService.db.transaction(async (tx) => {
        // 1. 'PROCESSING' 상태인 settlementBatch들을 조회
        const pendingBatches = await tx.query.settlementBatch.findMany({
          where: eq(schema.settlementBatch.status, BATCH_JOB_STATUS.PROCESSING),
          with: {
            items: {
              with: {
                bnplTransaction: {
                  with: {
                    bnplAccount: true,
                  },
                },
              },
            },
          },
        });

        if (pendingBatches.length === 0) {
          this.logger.log('[정산 확인] 확인할 정산 배치가 없습니다.');
          return;
        }

        this.logger.log(`[정산 확인] ${pendingBatches.length}개의 정산 배치 결과 확인`);

        // 2. 각 배치에 대해 개별 거래의 결과를 확인
        for (const batch of pendingBatches) {
          await this.checkBatchResult(tx, batch);
        }

        this.logger.log('[정산 확인] 정산 결과 확인 완료');
      });
    } catch (error) {
      this.logger.error('[정산 확인] 정산 결과 확인 실패:', error);
    }
  }

  /**
   * 개별 배치의 결과를 확인하는 헬퍼 메서드
   * 
   * PG사에서 배치의 최종 상태를 확인하고, 성공/실패에 따라 적절한 처리를 수행합니다.
   * 일관성을 위해 PaymentService의 capturePayment를 활용합니다.
   */
  private async checkBatchResult(
    tx: WalletTx,
    batch: SettlementBatchWithItems,
  ) {
    try {
      // 배치 유효성 검증
      if (!this.isValidBatch(batch)) {
        return;
      }

      // PG사 상태 확인
      const settlementStatus = await this.getSettlementStatus(batch.pgTransactionId!);
      if (!settlementStatus) {
        return;
      }

      // 상태에 따른 처리
      if (settlementStatus === 'PROCESSING') {
        this.logger.log(`[정산 확인] 배치 ${batch.id} 아직 처리 중`);
        return;
      }

      // 배치 상태 업데이트
      await this.updateBatchStatus(tx, batch.id, settlementStatus);

      // 각 거래 처리
      if (settlementStatus === 'SUCCESS') {
        await this.processSuccessfulSettlement(batch);
      } else {
        await this.processFailedSettlement(tx, batch);
      }

      // 완료 이벤트 발행
      this.emitSettlementCompletedEvent(batch, settlementStatus);

    } catch (error) {
      this.logger.error(`[정산 확인] 배치 ${batch.id} 처리 중 오류:`, error);
      throw error;
    }
  }

  /**
   * 배치 유효성 검증
   */
  private isValidBatch(batch: SettlementBatchWithItems): boolean {
    if (!batch.pgTransactionId) {
      this.logger.warn(`[정산 확인] 배치 ${batch.id}에 pgTransactionId가 없습니다.`);
      return false;
    }

    if (!batch.items || batch.items.length === 0) {
      this.logger.warn(`[정산 확인] 배치 ${batch.id}에 연결된 거래가 없습니다.`);
      return false;
    }

    return true;
  }

  /**
   * PG사에서 정산 상태 확인
   */
  private async getSettlementStatus(
    pgTransactionId: string
  ): Promise<'SUCCESS' | 'FAILED' | 'PROCESSING' | null> {
    const statusResult = await this.paymentProcessor.getPaymentStatus(
      pgTransactionId,
    ) as PaymentStatusResult;

    switch (statusResult.status) {
      case 'CAPTURED':
      case '출금성공':
        return 'SUCCESS';
      case 'FAILED':
      case '출금실패':
        return 'FAILED';
      case 'REQUESTED':
      case '출금대기':
      case '출금중':
        return 'PROCESSING';
      default:
        this.logger.warn(`[정산 확인] 알 수 없는 상태: ${statusResult.status}`);
        return null;
    }
  }

  /**
   * 배치 상태 업데이트
   */
  private async updateBatchStatus(
    tx: WalletTx,
    batchId: string,
    status: 'SUCCESS' | 'FAILED'
  ): Promise<void> {
    const batchStatus = status === 'SUCCESS' 
      ? BATCH_JOB_STATUS.COMPLETED 
      : BATCH_JOB_STATUS.FAILED;

    await tx
      .update(schema.settlementBatch)
      .set({ 
        status: batchStatus, 
        updatedAt: new Date() 
      })
      .where(eq(schema.settlementBatch.id, batchId));
  }

  /**
   * 정산 성공 처리
   * 
   * PaymentService.capturePayment를 활용하여 일관된 캡처 처리를 수행합니다.
   */
  private async processSuccessfulSettlement(
    batch: SettlementBatchWithItems
  ): Promise<void> {
    // 트랜잭션 외부에서 실행 (PaymentService가 자체 트랜잭션 사용)
    for (const item of batch.items) {
      const transaction = item.bnplTransaction;
      
      try {
        // PaymentEvent 조회
        const paymentEvent = await this.dbService.db.query.paymentEvents.findFirst({
          where: eq(schema.paymentEvents.paymentSessionId, transaction.paymentSessionId),
        });

        if (!paymentEvent) {
          this.logger.error(
            `[정산 확인] PaymentEvent를 찾을 수 없음: PaymentSession ${transaction.paymentSessionId}`
          );
          continue;
        }

        // PaymentService를 통한 일관된 캡처 처리
        await this.paymentService.capturePayment({
          paymentEventId: paymentEvent.id,
          amount: Number(transaction.amount),
        });

        this.logger.log(
          `[정산 확인] 거래 캡처 완료: PaymentEvent ${paymentEvent.id}`,
        );

      } catch (error) {
        this.logger.error(
          `[정산 확인] 거래 캡처 실패: PaymentSession ${transaction.paymentSessionId}`,
          error
        );
        // 개별 거래 실패는 계속 진행
      }
    }

    this.logger.log(
      `[정산 확인] 배치 ${batch.id} 정산 성공: ${batch.totalAmount}원`,
    );
  }

  /**
   * 정산 실패 처리
   */
  private async processFailedSettlement(
    tx: WalletTx,
    batch: SettlementBatchWithItems
  ): Promise<void> {
    // 모든 거래를 FAILED로 업데이트
    const transactionIds = batch.items.map(item => item.bnplTransaction.id);
    
    await tx
      .update(schema.bnplTransaction)
      .set({ status: FINANCIAL_TRANSACTION_STATUS.FAILED })
      .where(inArray(schema.bnplTransaction.id, transactionIds));

    // 각 거래별 처리
    for (const item of batch.items) {
      const transaction = item.bnplTransaction;

      // PaymentEvent 업데이트
      await tx
        .update(schema.paymentEvents)
        .set({
          status: FINANCIAL_TRANSACTION_STATUS.FAILED,
          errorMessage: '정산 실패',
          updatedAt: new Date(),
        })
        .where(eq(schema.paymentEvents.paymentSessionId, transaction.paymentSessionId));

      // PaymentSession 업데이트
      await tx
        .update(schema.paymentSessions)
        .set({
          status: PAYMENT_SESSION_STATUS.FAILED,
          updatedAt: new Date(),
        })
        .where(eq(schema.paymentSessions.id, transaction.paymentSessionId));

      // 실패 이벤트 발행
      const paymentEvent = await tx.query.paymentEvents.findFirst({
        where: eq(schema.paymentEvents.paymentSessionId, transaction.paymentSessionId),
      });

      if (paymentEvent) {
        this.eventEmitter.emit(
          'payment.failed',
          new PaymentFailedEvent(
            paymentEvent.id,
            transaction.paymentSessionId,
            Number(transaction.amount),
            '정산 실패',
            new Date(),
          ),
        );

        this.eventEmitter.emit(
          'payment-session.failed',
          {
            paymentSessionId: transaction.paymentSessionId,
            paymentEventId: paymentEvent.id,
            reason: '정산 실패',
            failedAt: new Date(),
          },
        );
      }
    }

    this.logger.error(
      `[정산 확인] 배치 ${batch.id} 정산 실패: ${batch.totalAmount}원`,
    );
  }

  /**
   * 정산 완료 이벤트 발행
   */
  private emitSettlementCompletedEvent(
    batch: SettlementBatchWithItems,
    status: 'SUCCESS' | 'FAILED'
  ): void {
    this.eventEmitter.emit(
      'settlement.batch.completed',
      new SettlementBatchCompletedEvent(
        batch.id,
        batch.bnplAccountId,
        Number(batch.totalAmount),
        status === 'SUCCESS' ? 'COMPLETED' : 'FAILED',
        new Date(),
      ),
    );
  }

  /**
   * 다음 정산일(출금일)을 계산하는 헬퍼 메서드
   */
  private calculateNextSettlementDate(): string {
    const now = new Date();
    // 다음 달 15일로 설정
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 15);
    const year = nextMonth.getFullYear();
    const month = (nextMonth.getMonth() + 1).toString().padStart(2, '0');
    const day = nextMonth.getDate().toString().padStart(2, '0');
    return `${year}${month}${day}`;
  }
}