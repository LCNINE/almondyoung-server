import { randomUUID } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { wmsTables } from '../../schema/inventory.schema';
import { stocktakingHarness } from './__fixtures__/stocktaking-harness';

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
describeDb('stocktaking reviewed preview applies only the reviewed count and inventory', () => {
  let h: ReturnType<typeof stocktakingHarness>;
  beforeAll(() => {
    h = stocktakingHarness(process.env.DATABASE_URL!);
  });
  afterAll(() => h.sql.end());
  const preview = async (id: string) =>
    h.service.generateAdjustments(id, { contractVersion: 2 } as any) as Promise<any>;
  const complete = (id: string, token: string) =>
    h.controller.completeSession(
      id,
      { contractVersion: 2, idempotencyKey: randomUUID(), previewToken: token } as any,
      h.actor,
    );

  it('returns a token even for zero variance and replays completion after response loss', async () => {
    const { scan, session } = await h.seed(1);
    await h.controller.scanProduct(scan, h.actor);
    const reviewed = await preview(session.id);
    expect(reviewed.previewToken).toMatch(/^[a-f0-9]{64}$/);
    expect(reviewed.preview).toEqual([]);
    const dto = { contractVersion: 2, idempotencyKey: randomUUID(), previewToken: reviewed.previewToken };
    const first = await h.controller.completeSession(session.id, dto, h.actor);
    await expect(h.controller.completeSession(session.id, dto, h.actor)).resolves.toEqual(
      JSON.parse(JSON.stringify(first)),
    );
  });

  it('refuses a reviewed count when another scan changes a formerly zero-variance line', async () => {
    const { scan, session, sku } = await h.seed(1);
    await h.controller.scanProduct(scan, h.actor);
    const reviewed = await preview(session.id);
    await h.controller.scanProduct({ ...scan, idempotencyKey: randomUUID() }, { id: randomUUID() });
    const before = await h.db.select().from(wmsTables.stockEvents).where(eq(wmsTables.stockEvents.skuId, sku.id));
    await expect(complete(session.id, reviewed.previewToken)).rejects.toThrow();
    const after = await h.db.select().from(wmsTables.stockEvents).where(eq(wmsTables.stockEvents.skuId, sku.id));
    expect(after).toHaveLength(before.length);
  });

  it('normal outbound after counting does not recreate the three dispatched items', async () => {
    const { scan, stockInput, session, sku } = await h.seed(5);
    await h.controller.scanProduct({ ...scan, quantity: 5 }, h.actor);
    const reviewed = await preview(session.id);
    await h.command.ship({ ...stockInput, quantity: 3 });
    await expect(complete(session.id, reviewed.previewToken)).rejects.toThrow();
    const [ledger] = await h.db.select().from(wmsTables.stockLedgers).where(eq(wmsTables.stockLedgers.skuId, sku.id));
    expect(ledger.qty).toBe(2);
  });

  it.each(['receive', 'adjustUp', 'moveInternal', 'reverseShip'] as const)(
    'serializes concurrent %s after the reviewed adjustment without losing new stock',
    async (operation) => {
      const { scan, stockInput, session, sku, otherLocation } = await h.seed(operation === 'reverseShip' ? 8 : 5);
      const shipped = operation === 'reverseShip' ? await h.command.ship({ ...stockInput, quantity: 3 }) : undefined;
      if (operation === 'moveInternal')
        await h.command.adjustUp({ ...stockInput, locationId: otherLocation.id, quantity: 3 });
      await h.controller.scanProduct({ ...scan, quantity: 4 }, h.actor);
      const reviewed = await preview(session.id);
      let release!: () => void;
      let entered!: () => void;
      const paused = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const resume = new Promise<void>((resolve) => {
        release = resolve;
      });
      const originalReview = (h.service as any).reviewCounts.bind(h.service);
      const spy = jest.spyOn(h.service as any, 'reviewCounts').mockImplementation(async (...args: any[]) => {
        const result = await originalReview(...args);
        entered();
        await resume;
        return result;
      });
      const completion = complete(session.id, reviewed.previewToken);
      await paused;
      const applicationName = `count-race-${randomUUID()}`;
      let writerFinished = false;
      const incoming = h.db
        .transaction(async (tx) => {
          await tx.execute(sql`select set_config('application_name', ${applicationName}, true)`);
          if (operation === 'receive') {
            await h.command.receive(
              {
                skuId: sku.id,
                toWarehouseId: stockInput.warehouseId,
                toLocationId: stockInput.locationId,
                quantity: 3,
              },
              tx,
            );
          } else if (operation === 'reverseShip') {
            await (h.command as any).eventStore.reverseEvent(shipped!.eventId, 'race test', tx);
          } else if (operation === 'moveInternal') {
            await h.command.moveInternal(
              {
                skuId: sku.id,
                warehouseId: stockInput.warehouseId,
                fromLocationId: otherLocation.id,
                toLocationId: stockInput.locationId,
                quantity: 3,
              },
              tx,
            );
          } else {
            await h.command.adjustUp({ ...stockInput, quantity: 3 }, tx);
          }
        })
        .finally(() => {
          writerFinished = true;
        });
      let advisoryBlocked = false;
      try {
        for (let attempts = 0; attempts < 200 && !writerFinished; attempts++) {
          const waiting =
            await h.sql`select wait_event from pg_stat_activity where application_name = ${applicationName}`;
          if (waiting.some((row) => row.wait_event === 'advisory')) {
            advisoryBlocked = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      } finally {
        release();
        await Promise.all([completion, incoming]);
        spy.mockRestore();
      }
      expect(advisoryBlocked).toBe(true);
      const ledgers = await h.db.select().from(wmsTables.stockLedgers).where(eq(wmsTables.stockLedgers.skuId, sku.id));
      expect(ledgers.find((ledger) => ledger.locationId === stockInput.locationId)!.qty).toBe(7);
      const [adjustment] = await h.db
        .select()
        .from(wmsTables.stocktakingAdjustments)
        .where(eq(wmsTables.stocktakingAdjustments.sessionId, session.id));
      expect(adjustment.adjustmentQuantity).toBe(1);
    },
  );

  it('rejects a registered but uncounted line even when variance rows are empty', async () => {
    const { scan, session, otherLocation, sku } = await h.seed(1);
    await h.controller.scanProduct(scan, h.actor);
    await h.db
      .insert(wmsTables.stocktakingLines)
      .values({ sessionId: session.id, skuId: sku.id, locationId: otherLocation.id, expectedQuantity: 1 });
    await expect(preview(session.id)).rejects.toThrow();
  });
  it('rejects a token after stock moves away and back, with no adjustment writes', async () => {
    const { scan, stockInput, session, otherLocation, sku } = await h.seed(5);
    await h.controller.scanProduct({ ...scan, quantity: 4 }, h.actor);
    const reviewed = await preview(session.id);
    const movement = {
      skuId: sku.id,
      warehouseId: stockInput.warehouseId,
      fromLocationId: stockInput.locationId,
      toLocationId: otherLocation.id,
      quantity: 1,
    };
    await h.command.moveInternal(movement);
    await h.command.moveInternal({
      ...movement,
      fromLocationId: otherLocation.id,
      toLocationId: stockInput.locationId,
    });
    const before = await h.db.select().from(wmsTables.stockEvents).where(eq(wmsTables.stockEvents.skuId, sku.id));
    await expect(complete(session.id, reviewed.previewToken)).rejects.toMatchObject({
      response: { code: 'STOCKTAKING_RECOUNT_REQUIRED' },
    });
    const after = await h.db.select().from(wmsTables.stockEvents).where(eq(wmsTables.stockEvents.skuId, sku.id));
    expect(after).toHaveLength(before.length);
  });

  it('invalidates the reviewed token if an uncounted line is added after preview', async () => {
    const { scan, session, otherLocation, sku, stockInput } = await h.seed(1);
    await h.controller.scanProduct(scan, h.actor);
    const reviewed = await preview(session.id);
    await h.command.adjustUp({ ...stockInput, locationId: otherLocation.id, quantity: 1 });
    await h.controller.scanLocation(
      { contractVersion: 2, idempotencyKey: randomUUID(), sessionId: session.id, locationBarcode: otherLocation.code },
      h.actor,
    );
    await expect(complete(session.id, reviewed.previewToken)).rejects.toMatchObject({
      response: { code: 'STOCKTAKING_COUNT_REQUIRED' },
    });
    const events = await h.db
      .select()
      .from(wmsTables.stocktakingAdjustments)
      .where(eq(wmsTables.stocktakingAdjustments.sessionId, session.id));
    expect(events).toHaveLength(0);
  });

  it('unrelated location inventory changes do not invalidate the counted location', async () => {
    const { scan, stockInput, session, otherLocation } = await h.seed(1);
    await h.controller.scanProduct(scan, h.actor);
    const reviewed = await preview(session.id);
    await h.command.adjustUp({ ...stockInput, locationId: otherLocation.id, quantity: 1 });
    await expect(complete(session.id, reviewed.previewToken)).resolves.toMatchObject({
      status: 'completed',
      summary: { adjustmentsApplied: 0 },
    });
  });
});
