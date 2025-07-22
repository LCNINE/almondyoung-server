import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDb, DbService } from '@app/db';
import * as schema from '../shared/schemas/schema';
import { FINANCIAL_TRANSACTION_STATUS, BATCH_JOB_STATUS } from '../shared/schemas/schema';
import { eq, inArray } from 'drizzle-orm';
import { ulid } from 'ulid';
import { PaymentProcessingPort } from './port/payment-processing.port';
import { WalletTx } from '../shared/types';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InvoicePaidEvent, InvoiceFailedEvent } from '../invoice/events/invoice.events';
import { PaymentCapturedEvent, PaymentFailedEvent, SettlementBatchStartedEvent, SettlementBatchCompletedEvent } from './events/payment.events';
import {
  SettlementBatchCreatedEvent,
  SettlementBatchFailedEvent,
  SettlementBatchItemAddedEvent,
  SettlementBatchStatusChangedEvent,
} from './events/settlement.events';
/**
 * 정산(Settlement) 도메인 서비스
 * - 역할: 사용자 중심 배치 정산 처리를 담당합니다.
 * - 월말 배치 생성: 사용자별 거래를 합산하여 월 1회 PG사에 출금 요청
 * - 정산 결과 확인: 배치 단위로 최종 성공/실패 상태를 확인하고 업데이트
 */
@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    @Inject(PaymentProcessingPort)
    private readonly paymentProcessor: PaymentProcessingPort,
    @InjectDb() private readonly dbService: DbService<typeof schema>,
    private readonly eventEmitter: EventEmitter2,
  ) { }

  /**
   * 월말 정산 배치 생성 (테스트 환경: 1분마다 실행)
   * 사용자별로 AUTHORIZED 거래를 그룹화하고 합산하여 월 1회 PG사에 배치 출금 요청
   */
  @Cron('0 * * * * *', {
    name: 'settlement-batch-test',
    timeZone: 'Asia/Seoul',
  })
  async createMonthlySettlementBatch() {
    this.logger.log('월말 정산 배치 생성 시작');
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
          this.logger.log('정산할 거래가 없습니다.');
          return;
        }

        this.logger.log(
          `${pendingTransactions.length}건의 거래에 대한 정산 처리 시작`,
        );

        // 2. 사용자별로 그룹화하여 정산 배치 생성
        const userGroups = this.groupTransactionsByUser(pendingTransactions);

        for (const userGroup of userGroups) {
          await this.processUserBatchSettlement(tx, userGroup);
        }

        this.logger.log('월말 정산 배치 생성 완료');
      });
    } catch (error) {
      this.logger.error('월말 정산 배치 생성 중 오류 발생', error);
    }
  }

  /**
   * 거래를 사용자별로 그룹화하는 헬퍼 메서드
   */
  private groupTransactionsByUser(transactions: any[]) {
    const userMap = new Map();

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

      const userGroup = userMap.get(userId);
      userGroup.totalAmount += Number(transaction.amount);
      userGroup.transactions.push(transaction);
    }

    return Array.from(userMap.values());
  }

  /**
   * 사용자별 배치 정산을 처리하는 헬퍼 메서드
   * 사용자의 모든 거래를 합산하여 1회 PG사에 출금 요청
   */
  private async processUserBatchSettlement(tx: WalletTx, userGroup: any) {
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
        `사용자 ${userGroup.userId} 정산 배치 생성: ${settlementBatch.id}, 총액: ${userGroup.totalAmount}원`,
      );

      // 🎯 정산 배치 생성 이벤트 발행 (Event Sourcing)
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
      this.logger.log(`HMS API 호출 시작: memberId=${paymentMethod.batchCms.hmsMemberId}, amount=${userGroup.totalAmount}`);

      const chargeResult = await this.paymentProcessor.charge({
        memberId: paymentMethod.batchCms.hmsMemberId,
        amount: userGroup.totalAmount,
        invoiceId: `BATCH_${settlementBatch.id}`, // 배치 ID를 invoiceId로 사용
        paymentDate: this.calculateNextSettlementDate(),
      });

      if (chargeResult.success) {
        // 타입 가드 이후: chargeResult는 이제 ChargeResult 타입으로 좁혀짐
        this.logger.log(`HMS API 응답: success=true, transactionId=${chargeResult.transactionId}`);
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

          // 🎯 정산 배치 아이템 추가 이벤트 발행 (Event Sourcing)
          this.eventEmitter.emit(
            'settlement.batch.item.added',
            new SettlementBatchItemAddedEvent(
              settlementBatch.id,
              transaction.id,
              Number(transaction.amount),
            ),
          );

          // (추가) 해당 거래의 invoiceId로 paymentEvents.pgTransactionId도 업데이트
          await tx
            .update(schema.paymentEvents)
            .set({ pgTransactionId: chargeResult.transactionId })
            .where(eq(schema.paymentEvents.invoiceId, transaction.invoiceId));
        }

        // 🎯 정산 배치 시작 이벤트 발행
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
          `사용자 ${userGroup.userId} 배치 정산 요청 성공: pgTransactionId=${chargeResult.transactionId}`,
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
        }

        // 🎯 정산 배치 실패 이벤트 발행 (Event Sourcing)
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
            `사용자 ${userGroup.userId} 배치 정산 요청 실패: ${chargeResult.error}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `사용자 ${userGroup.userId} 배치 정산 처리 중 오류:`,
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
    this.logger.log('정산 결과 확인 시작');

    try {
      await this.dbService.db.transaction(async (tx) => {
        // 1. 'PROCESSING' 상태인 settlementBatch들을 조회
        const pendingBatches = await tx.query.settlementBatch.findMany({
          where: eq(schema.settlementBatch.status, BATCH_JOB_STATUS.PROCESSING),
          with: {
            items: {
              with: {
                bnplTransaction: true,
              },
            },
          },
        });

        if (pendingBatches.length === 0) {
          this.logger.log('확인할 정산 배치가 없습니다.');
          return;
        }

        this.logger.log(`${pendingBatches.length}개의 정산 배치 결과 확인`);

        // 2. 각 배치에 대해 개별 거래의 결과를 확인
        for (const batch of pendingBatches) {
          await this.checkBatchResult(tx, batch);
        }

        this.logger.log('정산 결과 확인 완료');
      });
    } catch (error) {
      this.logger.error('정산 결과 확인 실패:', error);
    }
  }

  /**
   * 개별 배치의 결과를 확인하는 헬퍼 메서드
   * 배치 중심 모델: settlementBatch의 pgTransactionId로 배치 전체 상태를 확인
   */
  private async checkBatchResult(tx: WalletTx, batch: any) {
    try {
      if (!batch.pgTransactionId) {
        this.logger.warn(`배치 ${batch.id}에 pgTransactionId가 없습니다.`);
        return;
      }

      if (!batch.items || batch.items.length === 0) {
        this.logger.warn(`배치 ${batch.id}에 연결된 거래가 없습니다.`);
        return;
      }

      // PG사에서 배치 전체 상태 확인 (1회 API 호출)
      const statusResult = await this.paymentProcessor.getPaymentStatus(
        batch.pgTransactionId,
      );

      let batchFinalStatus: typeof BATCH_JOB_STATUS.COMPLETED | typeof BATCH_JOB_STATUS.FAILED | null = null;
      let transactionFinalStatus:
        | typeof FINANCIAL_TRANSACTION_STATUS.CAPTURED
        | typeof FINANCIAL_TRANSACTION_STATUS.FAILED
        | null = null;

      // HMS API 응답을 우리 시스템 상태로 변환
      switch (statusResult.status) {
        case 'CAPTURED':
        case '출금성공':
          batchFinalStatus = BATCH_JOB_STATUS.COMPLETED;
          transactionFinalStatus = FINANCIAL_TRANSACTION_STATUS.CAPTURED;
          break;
        case 'FAILED':
        case '출금실패':
          batchFinalStatus = BATCH_JOB_STATUS.FAILED;
          transactionFinalStatus = FINANCIAL_TRANSACTION_STATUS.FAILED;
          break;
        case 'REQUESTED':
        case '출금대기':
        case '출금중':
          // 아직 처리 중인 경우 - 상태 업데이트 없이 다음 번에 다시 확인
          this.logger.log(
            `배치 ${batch.id} 아직 처리 중: ${statusResult.status}`,
          );
          return;
        default:
          this.logger.warn(`알 수 없는 HMS 배치 상태: ${statusResult.status}`);
          return;
      }

      // 1. settlementBatch 상태 업데이트
      await tx
        .update(schema.settlementBatch)
        .set({ status: batchFinalStatus, updatedAt: new Date() })
        .where(eq(schema.settlementBatch.id, batch.id));

      // 2. 이 배치에 포함된 모든 거래 ID를 조회
      const batchItems = await tx.query.settlementBatchItem.findMany({
        where: eq(schema.settlementBatchItem.batchId, batch.id),
        columns: { bnplTransactionId: true },
      });
      const transactionIds = batchItems.map(item => item.bnplTransactionId);

      if (transactionIds.length > 0) {
        // 3. ✅ 모든 관련 bnplTransaction의 상태를 최종 상태로 업데이트
        //    'CAPTURED'로 변경되는 이 순간, 사용자의 신용 한도가 복원됩니다!
        await tx
          .update(schema.bnplTransaction)
          .set({ status: transactionFinalStatus })
          .where(inArray(schema.bnplTransaction.id, transactionIds));

        // 4. PaymentEvent (마스터 원장) 상태도 함께 업데이트 및 Invoice 이벤트 발행
        for (const item of batch.items) {
          const transaction = item.bnplTransaction;

          // PaymentEvent 상태 업데이트
          await tx
            .update(schema.paymentEvents)
            .set({
              status: transactionFinalStatus,
              updatedAt: new Date(),
            })
            .where(eq(schema.paymentEvents.invoiceId, transaction.invoiceId));

          // ✅ Payment & Invoice 이벤트 발행 (Event Sourcing)
          const paymentEvent = await tx.query.paymentEvents.findFirst({
            where: eq(schema.paymentEvents.invoiceId, transaction.invoiceId),
          });

          if (paymentEvent) {
            if (transactionFinalStatus === FINANCIAL_TRANSACTION_STATUS.CAPTURED) {
              // 🎯 Payment 완료 이벤트 발행
              this.eventEmitter.emit(
                'payment.captured',
                new PaymentCapturedEvent(
                  paymentEvent.id,
                  transaction.invoiceId,
                  Number(transaction.amount),
                  batch.pgTransactionId,
                  new Date(),
                ),
              );

              // 🎯 Invoice 결제 완료 이벤트 발행
              this.eventEmitter.emit(
                'invoice.paid',
                new InvoicePaidEvent(
                  transaction.invoiceId,
                  paymentEvent.id,
                  Number(transaction.amount),
                  new Date(),
                ),
              );
            } else if (transactionFinalStatus === FINANCIAL_TRANSACTION_STATUS.FAILED) {
              // 🎯 Payment 실패 이벤트 발행
              this.eventEmitter.emit(
                'payment.failed',
                new PaymentFailedEvent(
                  paymentEvent.id,
                  transaction.invoiceId,
                  Number(transaction.amount),
                  `정산 실패: ${statusResult.status}`,
                  new Date(),
                ),
              );

              // 🎯 Invoice 결제 실패 이벤트 발행
              this.eventEmitter.emit(
                'invoice.failed',
                new InvoiceFailedEvent(
                  transaction.invoiceId,
                  paymentEvent.id,
                  `정산 실패: ${statusResult.status}`,
                  new Date(),
                ),
              );
            }
          }
        }
      }

      // 🎯 정산 배치 완료 이벤트 발행
      this.eventEmitter.emit(
        'settlement.batch.completed',
        new SettlementBatchCompletedEvent(
          batch.id,
          batch.bnplAccountId,
          Number(batch.totalAmount),
          batchFinalStatus === BATCH_JOB_STATUS.COMPLETED ? 'COMPLETED' : 'FAILED',
          new Date(),
        ),
      );

      if (batchFinalStatus === BATCH_JOB_STATUS.COMPLETED) {
        this.logger.log(`배치 ${batch.id} 정산 성공: ${batch.totalAmount}원. 사용자 한도가 복원됩니다.`);
      } else {
        this.logger.error(`배치 ${batch.id} 정산 실패: ${batch.totalAmount}원`);
        // TODO: 실패 시 운영팀에 알림 발송 및 사용자에게 통보 로직 추가
      }
    } catch (error) {
      this.logger.error(`배치 ${batch.id} 결과 확인 중 오류:`, error);
    }
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
