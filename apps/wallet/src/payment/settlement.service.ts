import { Injectable, Logger } from '@nestjs/common';
import { eq, and, gte, lte } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { PaymentService } from './payment.service';
import * as schema from '../shared/schemas/schema';

import { DbService, InjectDb } from '@app/db';
// 추가된 임포트
import { settlementProcessEvent } from './schema/settlement-event.schema';
import { ulid } from 'ulid';

interface BatchItemResult {
  itemId: string;
  transactionId: string;
  invoiceId: number; // 실제 스키마 타입에 맞춤
  amount: string;
  status: 'SUCCESS' | 'FAILED';
  eventId?: string; // 성공 시만 존재
  error?: string; // 실패 시만 존재
}
/**
 * 정산 서비스 - 이벤트 소싱 패턴 구현
 *
 * 주요 역할:
 * 1. 정산 배치 생성 및 관리
 * 2. 정산 배치 항목 생성 및 관리
 * 3. 정산 처리 및 결제 캡처
 * 4. 정산 처리 과정 이벤트 기록
 */
@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
    private readonly paymentService: PaymentService,
  ) {
    this.logger.log('🚀 정산 서비스 초기화 완료');
  }

  // ... [createSettlementBatch 메서드 동일] ...

  /**
   * 정산 배치 처리 (이벤트 소싱 패턴 적용)
   *
   * 플로우:
   * 1. 정산 배치 조회
   * 2. 배치 시작 이벤트 기록
   * 3. 정산 배치 항목 조회
   * 4. 각 항목에 대해 결제 캡처 처리 (항목별 이벤트 기록)
   * 5. 정산 배치 상태 업데이트 및 완료 이벤트 기록
   *
   * @param batchId 정산 배치 ID
   * @returns 정산 배치 처리 결과
   */

  async processSettlementBatch(batchId: string) {
    this.logger.log(`정산 배치 처리 시작: ${batchId}`);

    try {
      // 1. 정산 배치 조회
      const batch = await this.dbService.db.query.settlementBatch.findFirst({
        where: eq(schema.settlementBatch.id, batchId),
      });

      if (!batch) {
        throw new Error(`정산 배치를 찾을 수 없습니다: ${batchId}`);
      }

      if (batch.status !== 'PENDING') {
        throw new Error(`정산 배치가 PENDING 상태가 아닙니다: ${batch.status}`);
      }

      // 2. 배치 시작 이벤트 기록
      await this.recordSettlementEvent({
        batchId,
        eventType: 'BATCH_STARTED',
        status: 'PROCESSING',
        actor: 'SCHEDULER',
      });

      // 3. 정산 배치 상태 업데이트 (PROCESSING)
      await this.dbService.db
        .update(schema.settlementBatch)
        .set({ status: 'PROCESSING', updatedAt: new Date() })
        .where(eq(schema.settlementBatch.id, batchId));

      // 4. 정산 배치 항목 조회
      const items = await this.dbService.db.query.settlementBatchItem.findMany({
        where: eq(schema.settlementBatchItem.batchId, batchId),
        with: {
          bnplTransaction: true,
        },
      });

      // 5. 각 항목에 대해 결제 캡처 처리
      const results: BatchItemResult[] = [];
      let successCount = 0;
      let failCount = 0;

      for (const item of items) {
        // 항목 처리 시작 이벤트 기록
        await this.recordSettlementEvent({
          batchId,
          batchItemId: item.id,
          eventType: 'ITEM_PROCESSING',
          status: 'PROCESSING',
          actor: 'SCHEDULER',
        });

        try {
          // 해당 거래의 인보이스 ID로 결제 이벤트 조회
          const paymentEvents =
            await this.paymentService.getPaymentEventsByInvoiceId(
              item.bnplTransaction.invoiceId,
            );

          if (paymentEvents.length === 0) {
            throw new Error(
              `결제 이벤트를 찾을 수 없습니다: invoiceId=${item.bnplTransaction.invoiceId}`,
            );
          }

          // REQUESTED 상태의 결제 이벤트 찾기
          const requestedEvent = paymentEvents.find(
            (event) => (event.status as unknown as string) === 'REQUESTED',
          );

          if (!requestedEvent) {
            throw new Error(
              `REQUESTED 상태의 결제 이벤트를 찾을 수 없습니다: invoiceId=${item.bnplTransaction.invoiceId}`,
            );
          }

          // 결제 캡처 처리
          const result = await this.paymentService.successPayment({
            invoiceId: requestedEvent.invoiceId,
            paymentMethodId: requestedEvent.paymentMethodId,
            amount: requestedEvent.amount,
            pgTransactionId: `settlement_${batchId}_${Date.now()}`,
            pgResponse: JSON.stringify({
              status: 'success',
              batchId,
              timestamp: new Date(),
            }),
            actor: 'SCHEDULER',
          });

          // 거래 상태 업데이트 (CAPTURED)
          await this.dbService.db
            .update(schema.bnplTransaction)
            .set({ status: 'CAPTURED' })
            .where(eq(schema.bnplTransaction.id, item.bnplTransaction.id));

          // 항목 처리 성공 이벤트 기록
          await this.recordSettlementEvent({
            batchId,
            batchItemId: item.id,
            eventType: 'ITEM_SUCCESS',
            status: 'SUCCESS',
            paymentEventId: result.id,
            actor: 'SCHEDULER',
          });

          results.push({
            itemId: item.id,
            transactionId: item.bnplTransaction.id,
            invoiceId: item.bnplTransaction.invoiceId,
            amount: item.amount,
            status: 'SUCCESS',
            eventId: result.id,
          });

          successCount++;
        } catch (error) {
          this.logger.error(
            `정산 배치 항목 처리 실패: ${item.id}, 오류: ${error.message}`,
          );

          // 항목 처리 실패 이벤트 기록
          await this.recordSettlementEvent({
            batchId,
            batchItemId: item.id,
            eventType: 'ITEM_FAILED',
            status: 'FAILED',
            errorMessage: error.message,
            actor: 'SCHEDULER',
          });

          results.push({
            itemId: item.id,
            transactionId: item.bnplTransaction.id,
            invoiceId: item.bnplTransaction.invoiceId,
            amount: item.amount,
            status: 'FAILED',
            error: error.message,
          });

          failCount++;
        }
      }

      // 6. 정산 배치 상태 업데이트 (SETTLED 또는 FAILED)
      const finalStatus =
        failCount === 0 ? 'SETTLED' : successCount === 0 ? 'FAILED' : 'SETTLED';

      await this.dbService.db
        .update(schema.settlementBatch)
        .set({ status: finalStatus, updatedAt: new Date() })
        .where(eq(schema.settlementBatch.id, batchId));

      // 7. 배치 완료 이벤트 기록
      await this.recordSettlementEvent({
        batchId,
        eventType:
          finalStatus === 'SETTLED' ? 'BATCH_COMPLETED' : 'BATCH_FAILED',
        status: finalStatus === 'SETTLED' ? 'SUCCESS' : 'FAILED',
        actor: 'SCHEDULER',
        metadata: JSON.stringify({
          totalItems: items.length,
          successCount,
          failCount,
        }),
      });

      this.logger.log(
        `정산 배치 처리 완료: ${batchId}, 성공: ${successCount}, 실패: ${failCount}`,
      );

      return {
        batchId,
        status: finalStatus,
        totalItems: items.length,
        successCount,
        failCount,
        results,
      };
    } catch (error) {
      this.logger.error(`정산 배치 처리 실패: ${error.message}`);

      // 정산 배치 상태 업데이트 (FAILED)
      await this.dbService.db
        .update(schema.settlementBatch)
        .set({ status: 'FAILED', updatedAt: new Date() })
        .where(eq(schema.settlementBatch.id, batchId));

      // 배치 실패 이벤트 기록
      await this.recordSettlementEvent({
        batchId,
        eventType: 'BATCH_FAILED',
        status: 'FAILED',
        errorMessage: error.message,
        actor: 'SCHEDULER',
      });

      throw error;
    }
  }

  /**
   * 정산 처리 이벤트 기록 (이벤트 소싱 패턴 핵심)
   *
   * @param eventData 이벤트 데이터
   */
  private async recordSettlementEvent(eventData: {
    batchId: string;
    eventType:
      | 'BATCH_STARTED'
      | 'ITEM_PROCESSING'
      | 'ITEM_SUCCESS'
      | 'ITEM_FAILED'
      | 'BATCH_COMPLETED'
      | 'BATCH_FAILED';
    status: 'PROCESSING' | 'SUCCESS' | 'FAILED';
    actor: 'SCHEDULER' | 'ADMIN' | 'SYSTEM';
    batchItemId?: string;
    paymentEventId?: string;
    errorMessage?: string;
    metadata?: string;
  }) {
    await this.dbService.db.insert(settlementProcessEvent).values({
      id: ulid(), // ULID 생성
      batchId: eventData.batchId,
      batchItemId: eventData.batchItemId,
      eventType: eventData.eventType,
      status: eventData.status,
      paymentEventId: eventData.paymentEventId,
      errorMessage: eventData.errorMessage,
      metadata: eventData.metadata,
      actor: eventData.actor,
      createdAt: new Date(),
    });

    this.logger.log(
      `[이벤트 기록] ${eventData.eventType} - 배치: ${eventData.batchId}`,
    );
  }

  // ... [getSettlementBatches, getSettlementBatchItems 메서드 동일] ...
}
