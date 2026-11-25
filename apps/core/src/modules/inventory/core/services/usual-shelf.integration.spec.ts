import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import {
  Database,
  inRollbackTx,
  makeInboundReceiptStateReader,
  makeInboundService,
} from '../../inbound/services/__fixtures__/inbound-harness';
import { seed as seedMovement, wiringFor } from '../../movement/services/__support__/movement-location-policy-fixtures';
import { readUsualShelves } from './usual-shelf';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('평소 선반 — 적치하며 비어 있을 때만 정한다 (PostgreSQL)', () => {
  jest.setTimeout(120_000);

  let client: postgres.Sql;
  let db: Database;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(client, { schema: wmsSchema });
  });

  afterAll(async () => {
    await client.end();
  });

  async function seedInbound(tx: DbTx) {
    const suffix = randomUUID().slice(0, 8);
    const [warehouse] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `usual-wh-${suffix}` })
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `usual-holder-${suffix}` })
      .returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: '평소 선반 상품', code: `USUAL-${randomUUID()}`, holderId: holder.id })
      .returning();
    return { warehouse, sku };
  }

  async function zone(tx: DbTx, warehouseId: string, extra: Partial<typeof wmsTables.locations.$inferInsert> = {}) {
    const [loc] = await tx
      .insert(wmsTables.locations)
      .values({ warehouseId, code: `S-${randomUUID().slice(0, 6)}`, locationType: 'zone', isActive: true, ...extra })
      .returning();
    return loc;
  }

  async function primaryOf(tx: DbTx, skuId: string) {
    const [row] = await tx
      .select({ id: wmsTables.skus.primaryLocationId })
      .from(wmsTables.skus)
      .where(eq(wmsTables.skus.id, skuId));
    return row.id;
  }

  async function receive(tx: DbTx, warehouseId: string, skuId: string, quantity: number) {
    const received = await makeInboundService(db).simpleInbound(
      { warehouseId, items: [{ skuId, quantity }], idempotencyKey: randomUUID() },
      tx,
    );
    return received.lines[0].id;
  }

  const stateOf = (tx: DbTx, lineId: string, warehouseId: string) =>
    makeInboundReceiptStateReader(db).getLineState({ lineId, warehouseId }, tx);

  it('입고 적치: 비어 있으면 그 선반으로 정하고, 다음 입고 줄 상태가 그 선반을 싣는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouse, sku } = await seedInbound(tx);
      const shelf = await zone(tx, warehouse.id);
      const first = await receive(tx, warehouse.id, sku.id, 3);

      expect(await stateOf(tx, first, warehouse.id)).toMatchObject({
        usualLocationId: null,
        usualLocationCode: null,
        canRememberUsual: true,
      });

      const result = await makeInboundService(db).putawayFromOrigin(
        { lineId: first, toLocationId: shelf.id, quantity: 3, rememberAsUsual: true, idempotencyKey: randomUUID() },
        tx,
      );
      expect(result).toEqual({ success: true, usualShelfSet: true });
      expect(await primaryOf(tx, sku.id)).toBe(shelf.id);

      const second = await receive(tx, warehouse.id, sku.id, 2);
      expect(await stateOf(tx, second, warehouse.id)).toMatchObject({
        usualLocationId: shelf.id,
        usualLocationCode: shelf.code,
        canRememberUsual: false,
      });
    });
  });

  it('입고 적치: 켜지 않으면 정하지 않고, 이미 정해진 선반은 다른 곳에 넣어도 바꾸지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouse, sku } = await seedInbound(tx);
      const usual = await zone(tx, warehouse.id);
      const other = await zone(tx, warehouse.id);

      const off = await makeInboundService(db).putawayFromOrigin(
        {
          lineId: await receive(tx, warehouse.id, sku.id, 1),
          toLocationId: other.id,
          quantity: 1,
          idempotencyKey: randomUUID(),
        },
        tx,
      );
      expect(off).toEqual({ success: true, usualShelfSet: false });
      expect(await primaryOf(tx, sku.id)).toBeNull();

      await tx.update(wmsTables.skus).set({ primaryLocationId: usual.id }).where(eq(wmsTables.skus.id, sku.id));
      const kept = await makeInboundService(db).putawayFromOrigin(
        {
          lineId: await receive(tx, warehouse.id, sku.id, 1),
          toLocationId: other.id,
          quantity: 1,
          rememberAsUsual: true,
          idempotencyKey: randomUUID(),
        },
        tx,
      );
      expect(kept).toEqual({ success: true, usualShelfSet: false });
      expect(await primaryOf(tx, sku.id)).toBe(usual.id);
    });
  });

  it('다른 창고에 평소 선반이 있으면 이 창고에서는 «없음»으로 보이되 정할 수 없고, 적치해도 덮지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouse, sku } = await seedInbound(tx);
      const [elsewhere] = await tx
        .insert(wmsTables.warehouses)
        .values({ name: `usual-other-${randomUUID().slice(0, 8)}` })
        .returning();
      const far = await zone(tx, elsewhere.id);
      await tx.update(wmsTables.skus).set({ primaryLocationId: far.id }).where(eq(wmsTables.skus.id, sku.id));
      const shelf = await zone(tx, warehouse.id);
      const line = await receive(tx, warehouse.id, sku.id, 1);

      expect(await stateOf(tx, line, warehouse.id)).toMatchObject({
        usualLocationId: null,
        canRememberUsual: false,
      });
      const result = await makeInboundService(db).putawayFromOrigin(
        { lineId: line, toLocationId: shelf.id, quantity: 1, rememberAsUsual: true, idempotencyKey: randomUUID() },
        tx,
      );
      expect(result.usualShelfSet).toBe(false);
      expect(await primaryOf(tx, sku.id)).toBe(far.id);
    });
  });

  it('재고 이동: 켠 줄만 비어 있으면 도착 선반으로 정하고, 시스템 자리로는 정하지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seedMovement(tx);
      await tx.update(wmsTables.locations).set({ isActive: true }).where(eq(wmsTables.locations.id, f.dest.id));
      await f.wiring.location.ensureSystemLocations(f.warehouseId, tx);
      const system = await f.wiring.location.getSystemLocationByRole(f.warehouseId, 'return_default', tx);
      const move = (toLocationId: string, rememberAsUsual?: boolean) =>
        wiringFor(tx).movement.moveImmediately({
          warehouseId: f.warehouseId,
          idempotencyKey: randomUUID(),
          lines: [{ skuId: f.skuId, fromLocationId: f.locationId, toLocationId, quantity: 1, rememberAsUsual }],
        });

      expect((await move(system.id, true)).usualShelfSkuIds).toEqual([]);
      expect(await primaryOf(tx, f.skuId)).toBeNull();
      expect((await move(f.dest.id)).usualShelfSkuIds).toEqual([]);
      expect(await primaryOf(tx, f.skuId)).toBeNull();
      expect((await move(f.dest.id, true)).usualShelfSkuIds).toEqual([f.skuId]);
      expect(await primaryOf(tx, f.skuId)).toBe(f.dest.id);
    });
  });

  it('재고 이동: 같은 키로 다시 보내면 정한 결과를 그대로 돌려주고 더 바꾸지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seedMovement(tx);
      await tx.update(wmsTables.locations).set({ isActive: true }).where(eq(wmsTables.locations.id, f.dest.id));
      const dto = {
        warehouseId: f.warehouseId,
        idempotencyKey: randomUUID(),
        lines: [
          { skuId: f.skuId, fromLocationId: f.locationId, toLocationId: f.dest.id, quantity: 1, rememberAsUsual: true },
        ],
      };
      const first = await wiringFor(tx).movement.moveImmediately(dto);
      const replay = await wiringFor(tx).movement.moveImmediately(dto);
      expect(first.usualShelfSkuIds).toEqual([f.skuId]);
      expect(replay.usualShelfSkuIds).toEqual([f.skuId]);
      expect(await primaryOf(tx, f.skuId)).toBe(f.dest.id);
    });
  });

  it('창고 ID 를 대문자로 받아도 같은 창고의 평소 선반을 보인다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouse, sku } = await seedInbound(tx);
      const shelf = await zone(tx, warehouse.id);
      await tx.update(wmsTables.skus).set({ primaryLocationId: shelf.id }).where(eq(wmsTables.skus.id, sku.id));
      const shelves = await readUsualShelves(tx, [sku.id], warehouse.id.toUpperCase());
      expect(shelves.get(sku.id)).toEqual({
        usualLocationId: shelf.id,
        usualLocationCode: shelf.code,
        canRememberUsual: false,
      });
    });
  });
});
