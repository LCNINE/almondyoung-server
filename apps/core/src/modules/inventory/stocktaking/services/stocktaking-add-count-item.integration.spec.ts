import { randomUUID } from 'crypto';
import { ConflictError } from '@app/shared';
import { and, eq } from 'drizzle-orm';
import { wmsTables } from '../../schema/inventory.schema';
import { stocktakingHarness } from './__fixtures__/stocktaking-harness';
import { StocktakingConflict } from './stocktaking-conflict';

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb('stocktaking add count item', () => {
  jest.setTimeout(120_000);

  let h: ReturnType<typeof stocktakingHarness>;

  beforeAll(() => {
    h = stocktakingHarness(process.env.DATABASE_URL!);
  });

  afterAll(() => h.sql.end());

  const inputFor = (
    fixture: Awaited<ReturnType<ReturnType<typeof stocktakingHarness>['seed']>>,
    countedQuantity = 2,
  ) => ({
    sessionId: fixture.session.id,
    locationId: fixture.otherLocation.id,
    skuId: fixture.sku.id,
    countedQuantity,
    contractVersion: 2 as const,
    idempotencyKey: randomUUID(),
  });

  function expectRevisionConflict(error: unknown) {
    expect(error).toBeInstanceOf(StocktakingConflict);
    expect((error as StocktakingConflict).getResponse()).toMatchObject({ code: 'STOCKTAKING_REVISION_CONFLICT' });
  }

  it('creates one counted line for a barcode-free SKU, replays exactly, and leaves inventory unchanged', async () => {
    const fixture = await h.seed(0);
    await h.db.delete(wmsTables.skuBarcodes).where(eq(wmsTables.skuBarcodes.skuId, fixture.sku.id));
    const input = inputFor(fixture);

    const first = await h.controller.addCountItem(input, h.actor);
    const replay = await h.controller.addCountItem(input, h.actor);

    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      skuId: fixture.sku.id,
      countedQuantity: 2,
      expectedQuantity: 0,
      variance: 2,
      lineRevision: 1,
      countBaselineVersion: 0,
    });
    const lines = await h.db
      .select()
      .from(wmsTables.stocktakingLines)
      .where(
        and(
          eq(wmsTables.stocktakingLines.sessionId, fixture.session.id),
          eq(wmsTables.stocktakingLines.skuId, fixture.sku.id),
          eq(wmsTables.stocktakingLines.locationId, fixture.otherLocation.id),
        ),
      );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ countedQuantity: 2, status: 'counted' });
    const ledgers = await h.db
      .select()
      .from(wmsTables.stockLedgers)
      .where(
        and(
          eq(wmsTables.stockLedgers.skuId, fixture.sku.id),
          eq(wmsTables.stockLedgers.locationId, fixture.otherLocation.id),
        ),
      );
    expect(ledgers).toHaveLength(0);
  });

  it('rejects reuse of the same idempotency key with a changed total', async () => {
    const fixture = await h.seed(0);
    const input = inputFor(fixture);
    await h.controller.addCountItem(input, h.actor);

    try {
      await h.controller.addCountItem({ ...input, countedQuantity: 3 }, h.actor);
      throw new Error('expected payload mismatch');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictError);
      expect((error as ConflictError).getHttpStatus()).toBe(409);
      expect((error as ConflictError).getErrorCode()).toBe('OPERATION_PAYLOAD_MISMATCH');
    }
  });

  it('is create-only when the session already contains the SKU and location', async () => {
    const fixture = await h.seed(0);
    const input = inputFor(fixture);
    await h.controller.addCountItem(input, h.actor);

    try {
      await h.controller.addCountItem({ ...input, idempotencyKey: randomUUID() }, h.actor);
      throw new Error('expected revision conflict');
    } catch (error) {
      expectRevisionConflict(error);
    }
  });

  it('captures the current location ledger quantity and version as its baseline', async () => {
    const fixture = await h.seed(0);
    await h.command.adjustUp({ ...fixture.stockInput, locationId: fixture.otherLocation.id, quantity: 4 });

    await expect(h.controller.addCountItem(inputFor(fixture, 1), h.actor)).resolves.toMatchObject({
      countedQuantity: 1,
      expectedQuantity: 4,
      variance: -3,
      countBaselineVersion: 1,
    });
  });

  it('allows an explicit zero total', async () => {
    const fixture = await h.seed(0);

    await expect(h.controller.addCountItem(inputFor(fixture, 0), h.actor)).resolves.toMatchObject({
      countedQuantity: 0,
      expectedQuantity: 0,
      variance: 0,
    });
  });

  it('rejects a location from another warehouse, an inactive location, and a completed session', async () => {
    const wrongWarehouseFixture = await h.seed(0);
    const otherWarehouse = await h.seed(0);
    await expect(
      h.controller.addCountItem(
        { ...inputFor(wrongWarehouseFixture), locationId: otherWarehouse.otherLocation.id },
        h.actor,
      ),
    ).rejects.toThrow();

    const inactiveFixture = await h.seed(0);
    await h.db
      .update(wmsTables.locations)
      .set({ isActive: false })
      .where(eq(wmsTables.locations.id, inactiveFixture.otherLocation.id));
    await expect(h.controller.addCountItem(inputFor(inactiveFixture), h.actor)).rejects.toThrow();

    const completedFixture = await h.seed(0);
    await h.db
      .update(wmsTables.stocktakingSessions)
      .set({ status: 'completed' })
      .where(eq(wmsTables.stocktakingSessions.id, completedFixture.session.id));
    await expect(h.controller.addCountItem(inputFor(completedFixture), h.actor)).rejects.toThrow();
  });

  it('rejects an unknown SKU without creating a line', async () => {
    const fixture = await h.seed(0);

    await expect(h.controller.addCountItem({ ...inputFor(fixture), skuId: randomUUID() }, h.actor)).rejects.toThrow();
    const lines = await h.db
      .select()
      .from(wmsTables.stocktakingLines)
      .where(eq(wmsTables.stocktakingLines.sessionId, fixture.session.id));
    expect(lines).toHaveLength(0);
  });

  it('serializes concurrent creates so exactly one request succeeds', async () => {
    const fixture = await h.seed(0);
    const input = inputFor(fixture);

    const outcomes = await Promise.allSettled([
      h.controller.addCountItem(input, h.actor),
      h.controller.addCountItem({ ...input, idempotencyKey: randomUUID() }, h.actor),
    ]);

    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['fulfilled', 'rejected']);
    const lines = await h.db
      .select()
      .from(wmsTables.stocktakingLines)
      .where(eq(wmsTables.stocktakingLines.sessionId, fixture.session.id));
    expect(lines).toHaveLength(1);
  });
});
