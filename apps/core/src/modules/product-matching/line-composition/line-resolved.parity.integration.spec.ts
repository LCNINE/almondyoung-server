import { randomUUID } from 'crypto';
import { inArray } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import {
  inRollbackTx,
  makeDb,
  makeDbService,
  seedHolder,
  seedSalesOrder,
  seedSku,
  wireLogistics,
} from '../../fulfillment/services/__support__';
import { lineResolvedSql } from './line-resolved.sql';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

type MatchingSeed = null | {
  status: 'pending' | 'matched' | 'ignored';
  strategy: 'variant' | 'void' | null;
  links: number;
};

const CASES: Array<{ name: string; matching: MatchingSeed; operator?: boolean }> = [
  { name: '매칭 없음', matching: null },
  { name: 'pending', matching: { status: 'pending', strategy: null, links: 0 } },
  { name: 'ignored + 링크', matching: { status: 'ignored', strategy: 'variant', links: 1 } },
  { name: 'matched variant 링크 0', matching: { status: 'matched', strategy: 'variant', links: 0 } },
  { name: 'matched variant 링크 1', matching: { status: 'matched', strategy: 'variant', links: 1 } },
  { name: 'matched void', matching: { status: 'matched', strategy: 'void', links: 0 } },
  { name: 'matched strategy null', matching: { status: 'matched', strategy: null, links: 0 } },
  { name: '운영자 지정 + 매칭 없음', matching: null, operator: true },
  { name: '운영자 지정 + pending', matching: { status: 'pending', strategy: null, links: 0 }, operator: true },
];

async function seedCase(tx: DbTx, skuId: string, c: (typeof CASES)[number]) {
  const variantId = randomUUID();
  const { salesOrderId, lineIds } = await seedSalesOrder(tx, { lines: [{ variantId, quantity: 1 }] });
  if (c.matching) {
    const [m] = await tx
      .insert(wmsTables.productMatchings)
      .values({
        variantId,
        status: c.matching.status,
        strategy: c.matching.strategy,
        isResolved: c.matching.status === 'matched',
      })
      .returning();
    for (let i = 0; i < c.matching.links; i += 1) {
      await tx.insert(wmsTables.productVariantSkuLinks).values({ productMatchingId: m.id, skuId, quantity: 1 });
    }
  }
  if (c.operator) {
    await tx
      .update(wmsTables.salesOrderLines)
      .set({ compositionSource: 'operator', compositionSetAt: new Date() })
      .where(inArray(wmsTables.salesOrderLines.id, lineIds));
    await tx
      .insert(wmsTables.salesOrderLineCompositions)
      .values({ salesOrderLineId: lineIds[0], skuId, qtyPerUnit: 1 });
  }
  return { salesOrderId, lineId: lineIds[0] };
}

describeIfDb('lineResolvedSql ↔ resolveLineComposition parity (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await client.end();
  });

  it.each(CASES)('$name: SQL 술어와 TS 판정이 같은 답', async (c) => {
    await inRollbackTx(db, async (tx) => {
      const w = wireLogistics(makeDbService(db));
      const { holderId } = await seedHolder(tx);
      const { skuId } = await seedSku(tx, holderId);
      const { salesOrderId, lineId } = await seedCase(tx, skuId, c);

      const [ts] = await w.lineCompositions.resolveForOrder(salesOrderId, tx);
      const tsResolved =
        ts.resolution.kind === 'frozen' || ts.resolution.kind === 'follow' || ts.resolution.kind === 'void';
      const [row] = await tx
        .select({ resolved: lineResolvedSql() })
        .from(wmsTables.salesOrderLines)
        .where(inArray(wmsTables.salesOrderLines.id, [lineId]));
      expect(row.resolved).toBe(tsResolved);
    });
  });
});
