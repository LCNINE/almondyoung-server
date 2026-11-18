import { createHash, randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../../inventory/schema/inventory.schema';
import { insertCustomerReturn } from '../../../sales-order/line-quantities/__support__/claim-facts.fixtures';

/**
 * 판매주문 하나를 «셀메이트에 넘긴 주문»으로 기록한다(#1412). 실제로는 `evening-reconcile init` 이 T 에 쓴다.
 * 회차는 `kind 'apply'` 로 넣는다 — `init` 은 부분 유니크 인덱스라 DB 에 init 이 이미 있으면 충돌한다.
 */
export async function seedHandedOverOrder(tx: DbTx, salesOrderId: string): Promise<void> {
  const [run] = await tx
    .insert(wmsTables.sellmateReconcileRuns)
    .values({
      kind: 'apply',
      status: 'closed',
      inputSha256: createHash('sha256').update(randomUUID()).digest('hex'),
      inputSnapshotAt: new Date(),
    })
    .returning();
  await tx.insert(wmsTables.sellmateHandedOverOrders).values({
    salesOrderId,
    displayId: Math.floor(Math.random() * 1_000_000_000),
    medusaOrderId: `order_${randomUUID()}`,
    runId: run.id,
  });
}

/** 판매주문의 줄을 교환 줄 꼴로 만든다 — 판정 술어(`exchange_return_line_id IS NOT NULL`)만 보는 픽스처다. */
export async function markOrderLinesAsExchange(tx: DbTx, salesOrderId: string): Promise<void> {
  const lines = await tx
    .select({ id: wmsTables.salesOrderLines.id })
    .from(wmsTables.salesOrderLines)
    .where(eq(wmsTables.salesOrderLines.salesOrderId, salesOrderId));

  for (const line of lines) {
    const { customerReturnId } = await insertCustomerReturn(tx, {
      salesOrderId,
      status: 'expected',
      lines: [{ salesOrderLineId: line.id, quantity: 1 }],
    });
    const [returnLine] = await tx
      .select({ id: wmsTables.customerReturnLines.id })
      .from(wmsTables.customerReturnLines)
      .where(eq(wmsTables.customerReturnLines.customerReturnId, customerReturnId));

    await tx
      .update(wmsTables.salesOrderLines)
      .set({ exchangeReturnLineId: returnLine.id })
      .where(eq(wmsTables.salesOrderLines.id, line.id));
  }
}
