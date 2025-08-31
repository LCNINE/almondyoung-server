import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { ulid } from 'ulid';
import { eq } from 'drizzle-orm';
import { SettlementRunDto } from '../shared/dtos/payments/settlement-run.dto.ts';

@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(private readonly db: DbService<typeof schema>) {}

  /**
   * 월별 정산 배치 실행 (MVP Stub)
   * - AUTHORIZED 상태의 bnpl_transaction → CAPTURED 전환
   * - settlement_batch, settlement_batch_item, settlement_process_event 기록
   */
  async runMonthlySettlement(dto: SettlementRunDto): Promise<{
    batchId: string;
    totalAmount: number;
  }> {
    return this.db.db.transaction(async (tx) => {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);

      // 1) AUTHORIZED 거래 조회
      const txns = await tx
        .select()
        .from(schema.bnplTransaction)
        .where(eq(schema.bnplTransaction.status, 'AUTHORIZED'));

      if (!txns.length) {
        this.logger.log('No transactions to settle');
        return { batchId: '', totalAmount: 0 };
      }

      // 2) settlement_batch 생성
      const [batch] = await tx
        .insert(schema.settlementBatch)
        .values({
          id: ulid(),
          bnplAccountId: txns[0].bnplAccountId, // MVP: 같은 계정이라고 가정
          batchNumber: `BATCH_${start.toISOString().slice(0, 7)}`,
          totalAmount: 0,
          dueDate: new Date(), // MVP stub
          status: 'PENDING',
          batchPeriodStart: start,
          batchPeriodEnd: end,
        })
        .returning();

      let total = 0;

      // 3) 거래들을 batch_item으로 묶기
      for (const t of txns) {
        total += Number(t.amount);
        await tx.insert(schema.settlementBatchItem).values({
          id: ulid(),
          batchId: batch.id,
          bnplTransactionId: t.id,
          amount: t.amount,
          transactionDate: t.createdAt,
        });

        // 각 거래 CAPTURED로 업데이트
        await tx
          .update(schema.bnplTransaction)
          .set({ status: 'CAPTURED' })
          .where(eq(schema.bnplTransaction.id, t.id));
      }

      // 4) 배치 total 업데이트 + 상태 PROCESSING → COMPLETED
      await tx
        .update(schema.settlementBatch)
        .set({
          totalAmount: total,
          status: 'COMPLETED',
        })
        .where(eq(schema.settlementBatch.id, batch.id));

      // 5) settlement_process_event 로그 기록
      await tx.insert(schema.settlementProcessEvent).values({
        id: ulid(),
        batchId: batch.id,
        eventType: 'BATCH_COMPLETED',
        status: 'CAPTURED', // ✅ MVP: CAPTURED 유지
        actor: 'SCHEDULER',
      });

      this.logger.log(`Settlement batch ${batch.id} completed, total=${total}`);

      return { batchId: batch.id, totalAmount: total };
    });
  }
}
