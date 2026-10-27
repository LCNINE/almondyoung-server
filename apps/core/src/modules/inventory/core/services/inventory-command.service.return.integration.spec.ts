import { outboxPublisherFor } from '../../../fulfillment/outbox/__support__/outbox-publisher.factory';
import { INVENTORY_STREAM } from '@packages/event-contracts/streams';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { StockStateEnum } from '../../schema/enum-values';
import { InventoryCommandService } from './inventory-command.service';
import { LocationService } from './location.service';
import { StockEventStore } from '../repositories/stock-event.store';
import { ProductSellableQuantityService } from '../../product-sellable-quantity/services/product-sellable-quantity.service';
import { readWarehouseAvailability } from '../../shared/availability/warehouse-availability';
import { seedShipmentLineFor } from '../../../fulfillment/services/__support__/logistics-fixtures';

/**
 * 반품 전이 셋(K8 PR 4) — 위치는 언제나 그 창고의 return_default, RETURNED 는 판매 불가.
 * rollback 전용 트랜잭션. 거절 케이스는 savepoint(tx.transaction) 안에서 불러 이벤트 삽입까지 되돌린다.
 *
 * 실행: DATABASE_URL=<core DB> npx jest --testPathPattern 'inventory-command.service.return.integration' --runInBand
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

class Rollback extends Error {}

describeIfDb('InventoryCommandService 반품 전이 (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);

  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let command: InventoryCommandService;
  let eventStore: StockEventStore;
  let location: LocationService;

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: wmsSchema });

    const dbService = {
      db,
      run: <T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) => (tx ? fn(tx) : db.transaction(fn)),
    } as unknown as DbService<typeof wmsSchema>;
    const outbox = outboxPublisherFor(INVENTORY_STREAM, dbService);
    const sellable = new ProductSellableQuantityService(dbService as never, outbox);
    eventStore = new StockEventStore(dbService, sellable);
    location = new LocationService(dbService);
    command = new InventoryCommandService(dbService, eventStore, outbox, location);
  });

  afterAll(async () => {
    await sql.end();
  });

  async function inRollbackTx(fn: (tx: DbTx) => Promise<void>) {
    await expect(
      db.transaction(async (tx) => {
        await fn(tx);
        throw new Rollback('intentional rollback');
      }),
    ).rejects.toThrow(Rollback);
  }

  async function createFixture(tx: DbTx, opts: { systemLocations: boolean } = { systemLocations: true }) {
    const [warehouse] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `it-wh-${randomUUID().slice(0, 8)}` })
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `it-holder-${randomUUID().slice(0, 8)}` })
      .returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'it-sku', code: `IT-${randomUUID()}`, holderId: holder.id })
      .returning();
    if (opts.systemLocations) await location.ensureSystemLocations(warehouse.id, tx);
    return { warehouse, sku };
  }

  async function ledgerQty(tx: DbTx, skuId: string, warehouseId: string, state: StockStateEnum) {
    const returnLocation = await location.getSystemLocationByRole(warehouseId, 'return_default', tx);
    const [row] = await tx
      .select({ qty: wmsTables.stockLedgers.qty })
      .from(wmsTables.stockLedgers)
      .where(
        and(
          eq(wmsTables.stockLedgers.skuId, skuId),
          eq(wmsTables.stockLedgers.warehouseId, warehouseId),
          eq(wmsTables.stockLedgers.locationId, returnLocation.id),
          eq(wmsTables.stockLedgers.stockState, state),
        ),
      );
    return row?.qty ?? 0;
  }

  async function eventsOf(tx: DbTx, skuId: string, transitionType: 'RETURN_ACCEPT' | 'MOVE') {
    return tx
      .select()
      .from(wmsTables.stockEvents)
      .where(and(eq(wmsTables.stockEvents.skuId, skuId), eq(wmsTables.stockEvents.transitionType, transitionType)));
  }

  const key = () => `it-return-${randomUUID()}`;

  it('반품 입고는 return_default 에 RETURNED 로 들어가고 가용에 잡히지 않는다', async () => {
    await inRollbackTx(async (tx) => {
      const { warehouse, sku } = await createFixture(tx);

      const result = await command.returnReceive(
        { skuId: sku.id, warehouseId: warehouse.id, quantity: 3, idempotencyKey: key() },
        tx,
      );

      expect(await ledgerQty(tx, sku.id, warehouse.id, 'RETURNED')).toBe(3);
      expect(await ledgerQty(tx, sku.id, warehouse.id, 'ON_HAND')).toBe(0);
      expect((await readWarehouseAvailability(tx, sku.id, warehouse.id)).available).toBe(0);
      const [event] = await tx
        .select()
        .from(wmsTables.stockEvents)
        .where(eq(wmsTables.stockEvents.id, result.eventId as string));
      expect(event).toMatchObject({ transitionType: 'RETURN_RECEIVE', fromState: null, toState: 'RETURNED' });
    });
  });

  it('검수 합격은 ON_HAND 로, 불합격은 DEFECTIVE 로 같은 위치에서 옮긴다', async () => {
    await inRollbackTx(async (tx) => {
      const { warehouse, sku } = await createFixture(tx);
      const base = { skuId: sku.id, warehouseId: warehouse.id };
      await command.returnReceive({ ...base, quantity: 3, idempotencyKey: key() }, tx);

      await command.returnAccept({ ...base, quantity: 2, idempotencyKey: key() }, tx);
      await command.returnReject({ ...base, quantity: 1, idempotencyKey: key() }, tx);

      expect(await ledgerQty(tx, sku.id, warehouse.id, 'RETURNED')).toBe(0);
      expect(await ledgerQty(tx, sku.id, warehouse.id, 'ON_HAND')).toBe(2);
      expect(await ledgerQty(tx, sku.id, warehouse.id, 'DEFECTIVE')).toBe(1);
      expect((await readWarehouseAvailability(tx, sku.id, warehouse.id)).available).toBe(2);
    });
  });

  it('들어온 것보다 많이 합격시키면 거절되고 원장·이벤트가 그대로다', async () => {
    await inRollbackTx(async (tx) => {
      const { warehouse, sku } = await createFixture(tx);
      const base = { skuId: sku.id, warehouseId: warehouse.id };
      await command.returnReceive({ ...base, quantity: 3, idempotencyKey: key() }, tx);

      await expect(
        tx.transaction((sp) => command.returnAccept({ ...base, quantity: 4, idempotencyKey: key() }, sp)),
      ).rejects.toThrow('insufficient on-hand at source');

      expect(await ledgerQty(tx, sku.id, warehouse.id, 'RETURNED')).toBe(3);
      expect(await ledgerQty(tx, sku.id, warehouse.id, 'ON_HAND')).toBe(0);
      expect(await eventsOf(tx, sku.id, 'RETURN_ACCEPT')).toHaveLength(0);
    });
  });

  it('같은 idempotencyKey 의 합격 두 번은 이벤트 하나, ON_HAND 한 번만 오른다', async () => {
    await inRollbackTx(async (tx) => {
      const { warehouse, sku } = await createFixture(tx);
      const base = { skuId: sku.id, warehouseId: warehouse.id };
      await command.returnReceive({ ...base, quantity: 3, idempotencyKey: key() }, tx);
      const accept = { ...base, quantity: 1, idempotencyKey: key() };

      const first = await command.returnAccept(accept, tx);
      const second = await command.returnAccept(accept, tx);

      expect(second.eventId).toBe(first.eventId);
      expect(await ledgerQty(tx, sku.id, warehouse.id, 'ON_HAND')).toBe(1);
      expect(await eventsOf(tx, sku.id, 'RETURN_ACCEPT')).toHaveLength(1);
    });
  });

  // 호출자가 키를 반품 줄 id 하나로만 만들면 합격이 입고 이벤트를 「성공」으로 돌려받고 물건은 RETURNED 에 남는다.
  it('같은 idempotencyKey 로 다른 전이·수량이 오면 기존 이벤트를 돌려주지 않고 409', async () => {
    await inRollbackTx(async (tx) => {
      const { warehouse, sku } = await createFixture(tx);
      const base = { skuId: sku.id, warehouseId: warehouse.id };
      const shared = key();
      await command.returnReceive({ ...base, quantity: 3, idempotencyKey: shared }, tx);

      await expect(command.returnAccept({ ...base, quantity: 3, idempotencyKey: shared }, tx)).rejects.toThrow(
        ConflictException,
      );
      await expect(command.returnReceive({ ...base, quantity: 2, idempotencyKey: shared }, tx)).rejects.toThrow(
        ConflictException,
      );
      expect(await ledgerQty(tx, sku.id, warehouse.id, 'RETURNED')).toBe(3);
    });
  });

  it('수량이 0 이하면 400', async () => {
    await inRollbackTx(async (tx) => {
      const { warehouse, sku } = await createFixture(tx);
      await expect(
        command.returnReceive({ skuId: sku.id, warehouseId: warehouse.id, quantity: 0, idempotencyKey: key() }, tx),
      ).rejects.toThrow(BadRequestException);
    });
  });

  it('return_default 위치가 없는 창고는 NotFoundException', async () => {
    await inRollbackTx(async (tx) => {
      const { warehouse, sku } = await createFixture(tx, { systemLocations: false });
      await expect(
        command.returnReceive({ skuId: sku.id, warehouseId: warehouse.id, quantity: 1, idempotencyKey: key() }, tx),
      ).rejects.toThrow(NotFoundException);
    });
  });

  it('합격 이벤트의 역분개는 반품 기록이 주인이라 거절되고 원장은 그대로다', async () => {
    await inRollbackTx(async (tx) => {
      const { warehouse, sku } = await createFixture(tx);
      const base = { skuId: sku.id, warehouseId: warehouse.id };
      await command.returnReceive({ ...base, quantity: 2, idempotencyKey: key() }, tx);
      const accepted = await command.returnAccept({ ...base, quantity: 2, idempotencyKey: key() }, tx);

      const error = await tx
        .transaction((sp) => eventStore.reverseEvent(accepted.eventId as string, 'it', sp))
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({ code: 'RETURN_EVENT_REVERSAL_NOT_ALLOWED' });
      expect(await ledgerQty(tx, sku.id, warehouse.id, 'ON_HAND')).toBe(2);
      expect(await ledgerQty(tx, sku.id, warehouse.id, 'RETURNED')).toBe(0);
    });
  });
});
