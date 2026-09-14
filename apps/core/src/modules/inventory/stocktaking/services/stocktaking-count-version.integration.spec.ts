import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { wmsTables } from '../../schema/inventory.schema';
import { stocktakingHarness } from './__fixtures__/stocktaking-harness';

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
describeDb('stocktaking count revisions and ledger baseline', () => {
  let h: ReturnType<typeof stocktakingHarness>;
  beforeAll(() => {
    h = stocktakingHarness(process.env.DATABASE_URL!);
  });
  afterAll(() => h.sql.end());

  it('returns revisions and refuses a stale direct count after another scan', async () => {
    const { scan } = await h.seed();
    const first = (await h.controller.scanProduct(scan, h.actor)) as any;
    expect(first.lineRevision).toBe(1);
    const next = (await h.controller.scanProduct({ ...scan, idempotencyKey: randomUUID() }, h.actor)) as any;
    expect(next.lineRevision).toBe(2);
    expect(next.sessionRevision).toBeGreaterThan(first.sessionRevision);
    const update = {
      contractVersion: 2,
      idempotencyKey: randomUUID(),
      countedQuantity: 9,
      expectedRevision: first.lineRevision,
    };
    await expect(h.controller.updateCount(first.lineId, update, h.actor)).rejects.toMatchObject({
      message: expect.any(String),
    });
    const [line] = await h.db
      .select()
      .from(wmsTables.stocktakingLines)
      .where(eq(wmsTables.stocktakingLines.id, first.lineId));
    expect(line.countedQuantity).toBe(2);
  });

  it('refuses continued counting after a stock round trip even though quantity is unchanged', async () => {
    const { scan, stockInput } = await h.seed();
    const first = await h.controller.scanProduct(scan, h.actor);
    await h.command.adjustDown({ ...stockInput, quantity: 5 });
    await h.command.adjustUp({ ...stockInput, quantity: 5 });
    await expect(h.controller.scanProduct({ ...scan, idempotencyKey: randomUUID() }, h.actor)).rejects.toMatchObject({
      message: expect.any(String),
    });
    const [line] = await h.db
      .select()
      .from(wmsTables.stocktakingLines)
      .where(eq(wmsTables.stocktakingLines.id, first.lineId));
    expect(line.countedQuantity).toBe(1);
  });

  it('requires explicit recount for migrated counted rows whose baseline is unknown', async () => {
    const { scan, sku, session, location } = await h.seed();
    await h.db
      .insert(wmsTables.stocktakingLines)
      .values({
        sessionId: session.id,
        skuId: sku.id,
        locationId: location.id,
        expectedQuantity: 5,
        countedQuantity: 4,
        variance: -1,
        status: 'counted',
      });
    await expect(h.controller.scanProduct(scan, h.actor)).rejects.toMatchObject({ message: expect.any(String) });
  });
  it('explicit reset starts a new baseline with null count; a subsequent explicit zero is counted', async () => {
    const { scan, stockInput } = await h.seed();
    const first = (await h.controller.scanProduct(scan, h.actor)) as any;
    await h.command.adjustUp({ ...stockInput, quantity: 1 });
    const reset = await (h.controller as any).resetCount?.(
      first.lineId,
      {
        contractVersion: 2,
        idempotencyKey: randomUUID(),
        expectedRevision: first.lineRevision,
      },
      h.actor,
    );
    expect(reset).toMatchObject({ countedQuantity: null, lineRevision: 2, countBaselineVersion: 2 });
    const counted = await h.controller.updateCount(
      first.lineId,
      { contractVersion: 2, idempotencyKey: randomUUID(), countedQuantity: 0, expectedRevision: reset.lineRevision },
      h.actor,
    );
    expect(counted.countedQuantity).toBe(0);
  });

  it('the absent ledger starts at baseline zero and a new stock row requires recount', async () => {
    const { scan, stockInput } = await h.seed(0);
    const first = await h.controller.scanProduct(scan, h.actor);
    expect(first.countBaselineVersion).toBe(0);
    await h.command.adjustUp({ ...stockInput, quantity: 1 });
    await expect(h.controller.scanProduct({ ...scan, idempotencyKey: randomUUID() }, h.actor)).rejects.toMatchObject({
      response: { code: 'STOCKTAKING_RECOUNT_REQUIRED' },
    });
  });

  it('concurrent stock movement and counting use compatible locks and retain both effects', async () => {
    const { scan, stockInput, otherLocation } = await h.seed(5);
    const result = await Promise.allSettled([
      h.controller.scanProduct(scan, h.actor),
      h.command.moveInternal({
        skuId: stockInput.skuId,
        warehouseId: stockInput.warehouseId,
        fromLocationId: stockInput.locationId,
        toLocationId: otherLocation.id,
        quantity: 1,
      }),
    ]);
    expect(result.map((item) => item.status)).toEqual(['fulfilled', 'fulfilled']);
    const lines = await h.db
      .select()
      .from(wmsTables.stocktakingLines)
      .where(eq(wmsTables.stocktakingLines.sessionId, scan.sessionId));
    expect(lines[0].countedQuantity).toBe(1);
  });
});
