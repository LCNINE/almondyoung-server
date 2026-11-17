import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import {
  consolidationBase,
  createConsolidationSource,
  inRollbackTx,
  makeDb,
  makeDbService,
  wireLogistics,
  Wired,
} from './__support__';
import { ConsolidationBoardReader } from './consolidation-board.reader';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('ConsolidationBoardReader (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let wired: Wired;
  let reader: ConsolidationBoardReader;

  beforeAll(() => {
    if (!DATABASE_URL) throw new Error('DATABASE_URL is required');

    ({ sql: client, db } = makeDb(DATABASE_URL));
    const dbService = makeDbService(db);

    wired = wireLogistics(dbService, 'v2');
    reader = new ConsolidationBoardReader(dbService);
  });

  afterAll(async () => {
    await client.end();
  });

  it('같은 고객 같은 주소 두 상자를 묶고, 상품 프로필이 어긋나거나 in_house 를 지원하지 않으면 뺀다', async () => {
    await inRollbackTx(db, async (tx) => {
      const base = await consolidationBase(tx);
      const customerId = randomUUID();
      const first = await createConsolidationSource(tx, wired, base, { quantity: 1, customerId });
      const second = await createConsolidationSource(tx, wired, base, { quantity: 1, customerId });
      const stranger = await createConsolidationSource(tx, wired, base, { quantity: 1, customerId: randomUUID() });
      const board = await reader.findBoard(base.warehouseId, tx);

      expect(board.groups).toHaveLength(1);
      expect(board.groups[0].shipments.map((shipment) => shipment.shipmentId).sort()).toEqual(
        [first.shipment.id, second.shipment.id].sort(),
      );
      expect(board.groups[0].canMergeNow).toBe(true);
      expect(board.groups[0].shipments.map((shipment) => shipment.items)).toEqual([
        [expect.objectContaining({ skuId: base.skuId, qty: 1 })],
        [expect.objectContaining({ skuId: base.skuId, qty: 1 })],
      ]);
      expect(JSON.stringify(board)).not.toContain(stranger.shipment.id);

      const [otherProfile] = await tx
        .insert(wmsTables.deliveryProfiles)
        .values({
          name: `board-other-profile-${randomUUID()}`,
          sourceType: 'in_house',
          supportedFulfillmentModes: ['in_house'],
        })
        .returning();

      await tx
        .update(wmsTables.skus)
        .set({ deliveryProfileId: otherProfile.id })
        .where(eq(wmsTables.skus.id, base.skuId));

      expect((await reader.findBoard(base.warehouseId, tx)).groups).toEqual([]);

      await tx
        .update(wmsTables.skus)
        .set({ deliveryProfileId: base.profileId })
        .where(eq(wmsTables.skus.id, base.skuId));

      expect((await reader.findBoard(base.warehouseId, tx)).groups).toHaveLength(1);

      await tx
        .update(wmsTables.deliveryProfiles)
        .set({ supportedFulfillmentModes: ['3pl'] })
        .where(eq(wmsTables.deliveryProfiles.id, base.profileId));

      expect((await reader.findBoard(base.warehouseId, tx)).groups).toEqual([]);
    });
  });
});
