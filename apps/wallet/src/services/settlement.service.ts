import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import * as schema from '../shared/database/schema';

@Injectable()
export class SettlementService {
  constructor(private readonly db: DbService<typeof schema>) {}

  async runMonthlySettlement(): Promise<{ batchId: string }> {
    return this.db.db.transaction(async (tx) => {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0); // 지난 달 마지막날

      // 1) 새 배치 생성
      const [batch] = await tx
        .insert(schema.settlementBatch)
        .values({
          bnplAccountId: 'stub_account', // MVP: 단일 계정 기준
          batchNumber: `BATCH_${start.toISOString().slice(0, 7)}`,
          totalAmount: 0,
          dueDate: new Date(),
          status: 'PENDING',
          batchPeriodStart: start,
          batchPeriodEnd: end,
        })
        .returning();

      // 2) 미정산 BNPL 거래 조회
      const txns = await tx
        .select()
        .from(schema.bnplTransaction)
        .where(eq(schema.bnplTransaction.status, 'AUTHORIZED'));

      let total = 0;
      for (const t of txns) {
        total += Number(t.amount);
        await tx.insert(schema.settlementBatchItem).values({
          batchId: batch.id,
          bnplTransactionId: t.id,
          amount: t.amount,
          transactionDate: t.createdAt,
        });
      }

      // 3) 배치 금액 업데이트
      await tx
        .update(schema.settlementBatch)
        .set({
          totalAmount: total,
          status: 'PROCESSING',
        })
        .where(eq(schema.settlementBatch.id, batch.id));

      // 4) Stub 처리 (즉시 성공)
      await tx.insert(schema.settlementProcessEvent).values({
        batchId: batch.id,
        eventType: 'BATCH_COMPLETED',
        status: 'CAPTURED',
        actor: 'SCHEDULER',
      });

      await tx
        .update(schema.settlementBatch)
        .set({ status: 'COMPLETED' })
        .where(eq(schema.settlementBatch.id, batch.id));

      return { batchId: batch.id };
    });
  }
}
