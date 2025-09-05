import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { eq, and, gte, lte } from 'drizzle-orm';
import { PaymentStrategyFactory } from '../factories/payment-strategy.factory';
import { IdempotencyService } from './idempotency.service';
import { BnplLedgerService } from './bnpl-ledger.service';
import { CaptureResult } from '../strategies/payment.strategy.interface';
import { ulid } from 'ulid';

export interface SettlementBatchResult {
  success: boolean;
  batchId?: string;
  totalAmount?: number;
  processedCount?: number;
  failedCount?: number;
  error?: string;
}

/**
 * 배치 캡처 및 정산 서비스
 * - 기존 settlement 스키마와 paymentEvent 연동
 * - BNPL 승인된 트랜잭션들의 월별 배치 처리
 * - settlementBatch, settlementBatchItem, settlementProcessEvent 활용
 */
@Injectable()
export class BatchCaptureService {
  private readonly logger = new Logger(BatchCaptureService.name);

  constructor(
    private readonly db: DbService<typeof schema>,
    private readonly strategyFactory: PaymentStrategyFactory,
    private readonly idempotency: IdempotencyService,
    private readonly bnplLedger: BnplLedgerService,
  ) {}

  /**
   * BNPL 월별 정산 배치 생성 및 실행
   */
  async createAndExecuteBnplSettlementBatch(
    bnplAccountId: string,
    periodStart: Date,
    periodEnd: Date,
    idempotencyKey?: string,
  ): Promise<SettlementBatchResult> {
    this.logger.log(
      `BNPL 정산 배치 생성: ${bnplAccountId} (${periodStart.toISOString()} ~ ${periodEnd.toISOString()})`,
    );

    const payload = { bnplAccountId, periodStart, periodEnd };

    return await this.db.db.transaction(async (tx) => {
      // 1. 멱등성 체크
      if (idempotencyKey) {
        const idempotencyResult = await this.idempotency.checkOrCreate(
          tx,
          idempotencyKey,
          payload,
          `/settlement/bnpl/batch`,
        );
        if (idempotencyResult.hit) {
          return idempotencyResult.response as SettlementBatchResult;
        }
      }

      try {
        // 2. 승인된 BNPL 트랜잭션 조회 (기간 내)
        const authorizedTransactions = await tx
          .select({
            id: schema.bnplEvents.id,
            amount: schema.bnplEvents.amount,
            createdAt: schema.bnplEvents.createdAt,
          })
          .from(schema.bnplEvents)
          .where(
            and(
              eq(schema.bnplEvents.bnplAccountId, bnplAccountId),
              eq(schema.bnplEvents.status, 'AUTHORIZED'),
              gte(schema.bnplEvents.createdAt, periodStart),
              lte(schema.bnplEvents.createdAt, periodEnd),
            ),
          );

        if (authorizedTransactions.length === 0) {
          const result: SettlementBatchResult = {
            success: true,
            batchId: '',
            totalAmount: 0,
            processedCount: 0,
            failedCount: 0,
          };

          if (idempotencyKey) {
            await this.idempotency.complete(tx, idempotencyKey, result, 200);
          }
          return result;
        }

        // 3. 정산 배치 생성
        const batchId = ulid();
        const totalAmount = authorizedTransactions.reduce(
          (sum, tx) => sum + Number(tx.amount),
          0,
        );

        await tx.insert(schema.settlementBatch).values({
          id: batchId,
          bnplAccountId,
          batchNumber: `BNPL-${bnplAccountId}-${periodStart.getFullYear()}${String(
            periodStart.getMonth() + 1,
          ).padStart(2, '0')}`,
          totalAmount,
          dueDate: new Date(periodEnd.getTime() + 7 * 24 * 60 * 60 * 1000), // 7일 후
          status: 'PENDING',
          batchPeriodStart: periodStart,
          batchPeriodEnd: periodEnd,
        });

        // 4. 배치 시작 이벤트 기록
        await this.recordSettlementEvent(tx, {
          batchId,
          eventType: 'BATCH_STARTED',
          status: 'PROCESSING',
          actor: 'SCHEDULER',
        });

        // 5. 배치 아이템 생성 및 처리
        let processedCount = 0;
        let failedCount = 0;

        for (const transaction of authorizedTransactions) {
          try {
            // 5-1. 배치 아이템 생성
            const itemId = ulid();
            await tx.insert(schema.settlementBatchItem).values({
              id: itemId,
              batchId,
              bnplEventId: transaction.id,
              amount: Number(transaction.amount),
              transactionDate: transaction.createdAt!,
            });

            // 5-2. 아이템 처리 이벤트 기록
            await this.recordSettlementEvent(tx, {
              batchId,
              batchItemId: itemId,
              eventType: 'ITEM_PROCESSING',
              status: 'PROCESSING',
              actor: 'SCHEDULER',
            });

            // 5-3. HMS API를 통한 실제 출금 처리
            const captureResult = await this.processSingleCapture(
              transaction.id,
            );

            if (captureResult.success) {
              // 성공 시 이벤트 기록
              await this.recordSettlementEvent(tx, {
                batchId,
                batchItemId: itemId,
                eventType: 'ITEM_CAPTURED',
                status: 'CAPTURED',
                actor: 'SCHEDULER',
                paymentEventId: captureResult.paymentEventId,
              });

              // 내부 원장 업데이트
              await this.bnplLedger.batchCapture(
                bnplAccountId,
                periodStart,
                periodEnd,
              );

              processedCount++;
            } else {
              // 실패 시 이벤트 기록
              await this.recordSettlementEvent(tx, {
                batchId,
                batchItemId: itemId,
                eventType: 'ITEM_FAILED',
                status: 'FAILED',
                actor: 'SCHEDULER',
                errorMessage: captureResult.error,
              });

              failedCount++;
            }
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : 'Unknown error';
            this.logger.error(
              `배치 아이템 처리 실패: ${transaction.id} - ${errorMessage}`,
            );
            failedCount++;
          }
        }

        // 6. 배치 완료 처리
        const batchSuccess = processedCount > 0 && failedCount === 0;
        const finalStatus = batchSuccess
          ? 'COMPLETED'
          : failedCount === authorizedTransactions.length
            ? 'FAILED'
            : 'COMPLETED';

        await tx
          .update(schema.settlementBatch)
          .set({
            status: finalStatus as any,
            updatedAt: new Date(),
          })
          .where(eq(schema.settlementBatch.id, batchId));

        // 7. 배치 완료 이벤트 기록
        await this.recordSettlementEvent(tx, {
          batchId,
          eventType: batchSuccess ? 'BATCH_COMPLETED' : 'BATCH_FAILED',
          status: batchSuccess ? 'CAPTURED' : 'FAILED',
          actor: 'SCHEDULER',
        });

        const result: SettlementBatchResult = {
          success: true,
          batchId,
          totalAmount,
          processedCount,
          failedCount,
        };

        if (idempotencyKey) {
          await this.idempotency.complete(tx, idempotencyKey, result, 200);
        }

        this.logger.log(
          `BNPL 정산 배치 완료: ${batchId} (성공: ${processedCount}, 실패: ${failedCount})`,
        );

        return result;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`BNPL 정산 배치 실패: ${errorMessage}`);

        const failureResult: SettlementBatchResult = {
          success: false,
          error: `정산 배치 처리 중 오류: ${errorMessage}`,
        };

        if (idempotencyKey) {
          await this.idempotency.complete(
            tx,
            idempotencyKey,
            failureResult,
            500,
          );
        }

        return failureResult;
      }
    });
  }

  /**
   * 정산 배치 상태 조회
   */
  async getSettlementBatchStatus(batchId: string): Promise<{
    success: boolean;
    batch?: any;
    items?: any[];
    events?: any[];
    error?: string;
  }> {
    try {
      // 배치 정보 조회
      const [batch] = await this.db.db
        .select()
        .from(schema.settlementBatch)
        .where(eq(schema.settlementBatch.id, batchId))
        .limit(1);

      if (!batch) {
        return {
          success: false,
          error: '정산 배치를 찾을 수 없습니다',
        };
      }

      // 배치 아이템 조회
      const items = await this.db.db
        .select()
        .from(schema.settlementBatchItem)
        .where(eq(schema.settlementBatchItem.batchId, batchId));

      // 배치 이벤트 조회
      const events = await this.db.db
        .select()
        .from(schema.settlementProcessEvent)
        .where(eq(schema.settlementProcessEvent.batchId, batchId));

      return {
        success: true,
        batch,
        items,
        events,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`정산 배치 상태 조회 실패: ${errorMessage}`);
      return {
        success: false,
        error: `정산 배치 상태 조회 중 오류: ${errorMessage}`,
      };
    }
  }

  /**
   * 대기 중인 정산 배치 조회
   */
  async getPendingSettlementBatches(): Promise<any[]> {
    try {
      return await this.db.db
        .select()
        .from(schema.settlementBatch)
        .where(eq(schema.settlementBatch.status, 'PENDING'));
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`대기 중인 정산 배치 조회 실패: ${errorMessage}`);
      return [];
    }
  }

  /**
   * 정산 프로세스 이벤트 기록
   */
  private async recordSettlementEvent(
    tx: any,
    event: {
      batchId: string;
      batchItemId?: string;
      eventType:
        | 'BATCH_STARTED'
        | 'ITEM_PROCESSING'
        | 'ITEM_AUTHORIZED'
        | 'ITEM_CAPTURED'
        | 'ITEM_FAILED'
        | 'BATCH_COMPLETED'
        | 'BATCH_FAILED';
      status: 'PROCESSING' | 'AUTHORIZED' | 'CAPTURED' | 'FAILED';
      actor: 'SCHEDULER' | 'ADMIN' | 'SYSTEM' | 'USER';
      paymentEventId?: string;
      errorMessage?: string;
    },
  ): Promise<void> {
    await tx.insert(schema.settlementProcessEvent).values({
      id: ulid(),
      batchId: event.batchId,
      batchItemId: event.batchItemId,
      eventType: event.eventType,
      status: event.status,
      paymentEventId: event.paymentEventId,
      errorMessage: event.errorMessage,
      actor: event.actor,
    });
  }

  /**
   * 단일 트랜잭션 캡처 처리 (HMS API 호출)
   */
  private async processSingleCapture(transactionId: string): Promise<{
    success: boolean;
    paymentEventId?: string;
    error?: string;
  }> {
    try {
      // BNPL Strategy를 통한 개별 캡처
      const bnplStrategy = this.strategyFactory.getStrategy('BNPL');
      if (!('batchCapture' in bnplStrategy)) {
        throw new Error('BNPL Strategy가 배치 캡처를 지원하지 않습니다');
      }

      const result = await bnplStrategy.batchCapture([transactionId]);

      if (result.success && result.captureIds && result.captureIds.length > 0) {
        // PaymentEvent 생성
        const paymentEventId = ulid();
        await this.db.db.insert(schema.paymentEvents).values({
          id: paymentEventId,
          paymentSessionId: transactionId, // 임시로 transactionId 사용
          paymentMethodId: '', // 실제로는 결제수단 ID 필요
          amount: 0, // 실제 금액 필요
          status: 'CAPTURED',
          pgTransactionId: result.captureIds?.[0] || '',
          pgResponse: JSON.stringify(result),
          actor: 'SCHEDULER',
        });

        return {
          success: true,
          paymentEventId,
        };
      } else {
        return {
          success: false,
          error: result.error || '캡처 실패',
        };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * 실패한 정산 배치 재시도
   */
  async retryFailedSettlementBatch(
    batchId: string,
  ): Promise<SettlementBatchResult> {
    this.logger.log(`정산 배치 재시도: ${batchId}`);

    try {
      const batchStatus = await this.getSettlementBatchStatus(batchId);
      if (!batchStatus.success || !batchStatus.batch) {
        return {
          success: false,
          error: '정산 배치를 찾을 수 없습니다',
        };
      }

      const batch = batchStatus.batch;
      if (batch.status !== 'FAILED') {
        return {
          success: false,
          error: '실패한 배치만 재시도할 수 있습니다',
        };
      }

      // 재시도 실행
      return await this.createAndExecuteBnplSettlementBatch(
        batch.bnplAccountId,
        batch.batchPeriodStart,
        batch.batchPeriodEnd,
        `retry_${batchId}_${Date.now()}`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`정산 배치 재시도 실패: ${errorMessage}`);
      return {
        success: false,
        error: `정산 배치 재시도 중 오류: ${errorMessage}`,
      };
    }
  }
}
