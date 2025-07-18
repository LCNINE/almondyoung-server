import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { eq, and, gte, lte } from 'drizzle-orm';
import { PaymentService } from './payment.service';
import * as schema from '../shared/schemas/schema'; // DB 스키마
import { DbService, InjectDb } from '@app/db';
import { ulid } from 'ulid';

// 💡 1. 역할에 맞는 타입을 명확하게 import 합니다.
// 서비스 로직을 위한 순수 타입과, Zod 검증을 위한 스키마를 가져옵니다.
import {
  SettlementBatch,
  SettlementProcessEvent,
  CreateSettlementProcessEventPayload,
  SettlementBatchItemWithTransaction,
  CapturePaymentPayload,
} from '../shared/zod'; // 실제 경로는 맞게 수정해주세요.

/**
 * 💡 2. 서비스 내부에서만 사용되는 복잡한 데이터 구조를 명확하게 타입으로 정의합니다.
 * 이는 코드의 가독성과 안정성을 크게 향상시킵니다.
 */
// 각 정산 항목 처리 결과
type ProcessedBatchItemResult = {
  itemId: string;
  transactionId: string;
  invoiceId: number;
  amount: number;
  status: 'SUCCESS' | 'FAILED';
  paymentEventId?: string; // 성공 시에만 존재
  error?: string; // 실패 시에만 존재
};

// 정산 배치 전체 처리 결과
type ProcessedBatchResult = {
  batchId: string;
  status: SettlementBatch['status'];
  totalItems: number;
  successCount: number;
  failCount: number;
  results: ProcessedBatchItemResult[];
};

@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
    private readonly paymentService: PaymentService,
  ) {}

  // ... [createSettlementBatch 메서드 등 다른 메서드] ...

  /**
   * 정산 배치 처리를 수행합니다.
   * @param batchId 처리할 정산 배치의 ID
   * @returns 정산 처리 결과
   */
  async processSettlementBatch(batchId: string): Promise<ProcessedBatchResult> {
    this.logger.log(`정산 배치 처리 시작: ${batchId}`);

    // 1. 정산 배치 조회 및 상태 검증
    const batch = await this.dbService.db.query.settlementBatch.findFirst({
      where: eq(schema.settlementBatch.id, batchId),
    });

    if (!batch) {
      throw new NotFoundException(`정산 배치를 찾을 수 없습니다: ${batchId}`);
    }
    if (batch.status !== 'PENDING') {
      this.logger.warn(`정산 배치가 PENDING 상태가 아닙니다: ${batch.status}`);
      // 이미 처리되었거나 진행 중인 경우, 추가 작업을 막기 위해 여기서 종료할 수 있습니다.
      // 또는 현재 상태를 그대로 반환하는 등의 정책을 정할 수 있습니다.
      throw new Error(`정산 배치가 PENDING 상태가 아닙니다: ${batch.status}`);
    }

    try {
      // 2. 배치 처리 시작 기록
      await this.dbService.db
        .update(schema.settlementBatch)
        .set({ status: 'PROCESSING', updatedAt: new Date() })
        .where(eq(schema.settlementBatch.id, batchId));
      await this.recordSettlementEvent({
        batchId,
        eventType: 'BATCH_STARTED',
        status: 'PROCESSING',
        actor: 'SCHEDULER',
      });

      // 3. 처리할 항목들 조회
      const items = await this.dbService.db.query.settlementBatchItem.findMany({
        where: eq(schema.settlementBatchItem.batchId, batchId),
        with: {
          bnplTransaction: true,
        },
      });

      // 4. 각 항목을 순회하며 결제 처리
      const processingResults = await Promise.all(
        items.map((item) =>
          this.processSingleItem(
            batch.id,
            item as SettlementBatchItemWithTransaction,
          ),
        ),
      );

      // 5. 최종 결과 집계
      const successCount = processingResults.filter(
        (r) => r.status === 'SUCCESS',
      ).length;
      const failCount = processingResults.length - successCount;
      const finalStatus: SettlementBatch['status'] =
        failCount === 0 ? 'SETTLED' : 'FAILED';

      // 6. 배치 상태 최종 업데이트 및 완료 이벤트 기록
      await this.dbService.db
        .update(schema.settlementBatch)
        .set({ status: finalStatus, updatedAt: new Date() })
        .where(eq(schema.settlementBatch.id, batchId));
      await this.recordSettlementEvent({
        batchId,
        eventType: 'BATCH_COMPLETED',
        status: finalStatus === 'SETTLED' ? 'CAPTURED' : 'FAILED',
        actor: 'SCHEDULER',
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
        results: processingResults,
      };
    } catch (error) {
      this.logger.error(
        `정산 배치 처리 중 심각한 오류 발생: ${batchId}, ${error.message}`,
      );
      // 7. 예외 발생 시 배치 상태를 FAILED로 변경하고 이벤트 기록
      await this.dbService.db
        .update(schema.settlementBatch)
        .set({ status: 'FAILED', updatedAt: new Date() })
        .where(eq(schema.settlementBatch.id, batchId));
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
   * 개별 정산 항목을 처리하고 결과를 반환합니다.
   * @param batchId 현재 처리 중인 배치 ID
   * @param item 처리할 정산 항목 (BNPL 트랜잭션 포함)
   * @returns 항목 처리 결과
   */
  private async processSingleItem(
    batchId: string,
    item: SettlementBatchItemWithTransaction,
  ): Promise<ProcessedBatchItemResult> {
    const { id: itemId, bnplTransaction } = item;
    const { id: transactionId, invoiceId, amount } = bnplTransaction;

    await this.recordSettlementEvent({
      batchId,
      batchItemId: itemId,
      eventType: 'ITEM_PROCESSING',
      status: 'PROCESSING',
      actor: 'SCHEDULER',
    });

    try {
      // � 3. 타입이 보장된 환경에서 안전하게 로직 수행
      // paymentService에서 반환된 타입은 `PaymentEvent[]`로 가정합니다.
      const paymentEvents =
        await this.paymentService.getPaymentEventsByInvoiceId(invoiceId);

      // `as unknown as string` 같은 위험한 캐스팅 대신, 타입 그대로 비교합니다.
      const requestedEvent = paymentEvents.find(
        (event) => event.status === 'REQUESTED',
      );

      if (!requestedEvent) {
        throw new Error(`REQUESTED 상태의 결제 이벤트를 찾을 수 없습니다.`);
      }

      // 💡 4. 다른 서비스 호출 시 명확한 페이로드 타입을 사용합니다.
      const capturePayload: CapturePaymentPayload = {
        id: requestedEvent.id,
        actor: 'SCHEDULER',
      };
      const capturedEvent =
        await this.paymentService.capturePayment(capturePayload);

      await this.dbService.db
        .update(schema.bnplTransaction)
        .set({ status: 'CAPTURED' })
        .where(eq(schema.bnplTransaction.id, transactionId));

      await this.recordSettlementEvent({
        batchId,
        batchItemId: itemId,
        eventType: 'ITEM_CAPTURED',
        status: 'CAPTURED',
        paymentEventId: capturedEvent.id,
        actor: 'SCHEDULER',
      });

      return {
        itemId,
        transactionId,
        invoiceId,
        amount,
        status: 'SUCCESS',
        paymentEventId: capturedEvent.id,
      };
    } catch (error) {
      this.logger.error(
        `정산 항목 처리 실패: ${itemId}, 오류: ${error.message}`,
      );
      await this.recordSettlementEvent({
        batchId,
        batchItemId: itemId,
        eventType: 'ITEM_FAILED',
        status: 'FAILED',
        errorMessage: error.message,
        actor: 'SCHEDULER',
      });
      return {
        itemId,
        transactionId,
        invoiceId,
        amount,
        status: 'FAILED',
        error: error.message,
      };
    }
  }

  /**
   * 정산 처리 이벤트를 기록합니다. (이벤트 소싱 패턴 핵심)
   * @param payload 이벤트 생성을 위한 순수 데이터 객체
   */
  private async recordSettlementEvent(
    payload: CreateSettlementProcessEventPayload,
  ): Promise<void> {
    const eventData: SettlementProcessEvent = {
      ...payload,
      id: ulid(), // ID는 여기서 생성
      createdAt: new Date(), // 생성 시간은 여기서 지정
    };

    await this.dbService.db
      .insert(schema.settlementProcessEvent)
      .values(eventData);
    this.logger.log(
      `[이벤트 기록] ${payload.eventType} - 배치: ${payload.batchId}`,
    );
  }
}
