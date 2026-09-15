import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as postgres from 'postgres';
import { ConflictException } from '@nestjs/common';
import { DbTx, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import { InboundService } from '../../inbound/services/inbound.service';
import { Database, inRollbackTx, makeInboundService } from '../../inbound/services/__fixtures__/inbound-harness';
import {
  assertInboundOriginRemovalAllowed,
  InboundOriginKey,
  readInboundOriginAvailability,
} from './inbound-origin-availability';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('inbound origin availability (PostgreSQL integration)', () => {
  jest.setTimeout(120_000);

  let client: postgres.Sql;
  let db: Database;
  let svc: InboundService;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(client, { schema: wmsSchema });
    svc = makeInboundService(db);
  });

  afterAll(async () => {
    await client.end();
  });

  async function seed(tx: DbTx) {
    const suffix = randomUUID();
    const [warehouse, otherWarehouse] = await tx
      .insert(wmsTables.warehouses)
      .values([
        { name: `origin-availability-wh-${suffix.slice(0, 8)}` },
        { name: `origin-availability-other-wh-${suffix.slice(0, 8)}` },
      ])
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `origin-availability-holder-${suffix.slice(0, 8)}` })
      .returning();
    const [sku, otherSku] = await tx
      .insert(wmsTables.skus)
      .values([
        { name: 'origin availability sku', code: `ORIGIN-${suffix}`, holderId: holder.id },
        { name: 'origin availability other sku', code: `ORIGIN-OTHER-${suffix}`, holderId: holder.id },
      ])
      .returning();
    const [shelf] = await tx
      .insert(wmsTables.locations)
      .values({
        warehouseId: warehouse.id,
        code: `OA-${suffix.slice(0, 6)}`,
        locationType: 'zone',
        isSystem: false,
        systemRole: null,
        isActive: true,
      })
      .returning();
    return { warehouse, otherWarehouse, sku, otherSku, shelf };
  }

  async function receiveAtDefault(tx: DbTx, warehouseId: string, skuId: string, quantity: number) {
    const received = await svc.simpleInbound(
      {
        warehouseId,
        items: [{ skuId, quantity }],
        idempotencyKey: randomUUID(),
      },
      tx,
    );
    const line = received.lines[0];
    if (!line?.originLocationId) throw new Error('simple inbound did not create an origin location');
    return {
      received,
      line,
      key: { skuId, warehouseId, sourceLocationId: line.originLocationId } satisfies InboundOriginKey,
    };
  }

  async function setOnHand(tx: DbTx, key: InboundOriginKey, qty: number) {
    await tx
      .update(wmsTables.stockLedgers)
      .set({ qty })
      .where(
        and(
          eq(wmsTables.stockLedgers.skuId, key.skuId),
          eq(wmsTables.stockLedgers.warehouseId, key.warehouseId),
          eq(wmsTables.stockLedgers.locationId, key.sourceLocationId),
          eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
        ),
      );
  }

  it.each([
    { quantity: 10, putaway: 6, canceled: 0, returned: 0, expected: 4 },
    { quantity: 10, putaway: 0, canceled: 10, returned: 0, expected: 0 },
    { quantity: 10, putaway: 0, canceled: 0, returned: 3, expected: 7 },
  ])('미처리 입고를 누계에서 계산한다: %j', async (c) => {
    await inRollbackTx(db, async (tx) => {
      const { warehouse, sku } = await seed(tx);
      const { line, key } = await receiveAtDefault(tx, warehouse.id, sku.id, 1);
      await tx
        .update(wmsTables.inboundReceiptLines)
        .set({
          quantity: c.quantity,
          putawayFromOriginQty: c.putaway,
          canceledQty: c.canceled,
          returnedQty: c.returned,
        })
        .where(eq(wmsTables.inboundReceiptLines.id, line.id));
      expect((await readInboundOriginAvailability(tx, key)).pendingQty).toBe(c.expected);
    });
  });

  it('같은 SKU와 원위치의 direct·purchase_order 라인을 합산한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouse, sku } = await seed(tx);
      const first = await receiveAtDefault(tx, warehouse.id, sku.id, 4);
      const second = await receiveAtDefault(tx, warehouse.id, sku.id, 6);
      await tx
        .update(wmsTables.inboundReceiptLines)
        .set({ source: 'purchase_order' })
        .where(eq(wmsTables.inboundReceiptLines.id, second.line.id));

      expect(await readInboundOriginAvailability(tx, first.key)).toEqual({
        onHandQty: 10,
        pendingQty: 10,
        invalidReceipt: false,
      });
    });
  });

  it('voided 회차를 제외한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouse, sku } = await seed(tx);
      const { received, key } = await receiveAtDefault(tx, warehouse.id, sku.id, 5);
      await tx
        .update(wmsTables.inboundReceipts)
        .set({ status: 'voided' })
        .where(eq(wmsTables.inboundReceipts.id, received.receipt.id));

      expect(await readInboundOriginAvailability(tx, key)).toEqual({
        onHandQty: 5,
        pendingQty: 0,
        invalidReceipt: false,
      });
    });
  });

  it('다른 SKU·창고·시스템 원위치의 라인을 grain에서 제외한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouse, otherWarehouse, sku, otherSku } = await seed(tx);
      const target = await receiveAtDefault(tx, warehouse.id, sku.id, 2);
      await receiveAtDefault(tx, warehouse.id, otherSku.id, 3);
      await receiveAtDefault(tx, otherWarehouse.id, sku.id, 5);
      const [otherOrigin] = await tx
        .select()
        .from(wmsTables.locations)
        .where(
          and(eq(wmsTables.locations.warehouseId, warehouse.id), eq(wmsTables.locations.systemRole, 'return_default')),
        )
        .limit(1);
      await svc.individualInbound(
        {
          warehouseId: warehouse.id,
          skuId: sku.id,
          quantity: 7,
          locationId: otherOrigin.id,
          idempotencyKey: randomUUID(),
        },
        tx,
      );

      expect(await readInboundOriginAvailability(tx, target.key)).toEqual({
        onHandQty: 2,
        pendingQty: 2,
        invalidReceipt: false,
      });
    });
  });

  it('일반 선반 직접입고는 onHand만 읽고 pending에 포함하지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouse, sku, shelf } = await seed(tx);
      await svc.individualInbound(
        {
          warehouseId: warehouse.id,
          skuId: sku.id,
          quantity: 7,
          locationId: shelf.id,
          idempotencyKey: randomUUID(),
        },
        tx,
      );

      expect(
        await readInboundOriginAvailability(tx, {
          skuId: sku.id,
          warehouseId: warehouse.id,
          sourceLocationId: shelf.id,
        }),
      ).toEqual({ onHandQty: 7, pendingQty: 0, invalidReceipt: false });
    });
  });

  it.each(['zero', 'missing'] as const)('원장이 %s이어도 pending을 clamp하지 않는다', async (ledgerState) => {
    await inRollbackTx(db, async (tx) => {
      const { warehouse, sku } = await seed(tx);
      const { key } = await receiveAtDefault(tx, warehouse.id, sku.id, 10);
      if (ledgerState === 'zero') {
        await setOnHand(tx, key, 0);
      } else {
        await tx
          .delete(wmsTables.stockLedgers)
          .where(
            and(
              eq(wmsTables.stockLedgers.skuId, key.skuId),
              eq(wmsTables.stockLedgers.warehouseId, key.warehouseId),
              eq(wmsTables.stockLedgers.locationId, key.sourceLocationId),
              eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
            ),
          );
      }

      expect(await readInboundOriginAvailability(tx, key)).toEqual({
        onHandQty: 0,
        pendingQty: 10,
        invalidReceipt: false,
      });
      await expect(assertInboundOriginRemovalAllowed(tx, { ...key, quantity: 0 })).rejects.toMatchObject({
        response: { code: 'INBOUND_ORIGIN_STOCK_INCONSISTENT' },
      });
    });
  });

  it('음수 잔량은 invalidReceipt로 보고한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouse, sku } = await seed(tx);
      const { line, key } = await receiveAtDefault(tx, warehouse.id, sku.id, 10);
      await tx
        .update(wmsTables.inboundReceiptLines)
        .set({ putawayFromOriginQty: 11 })
        .where(eq(wmsTables.inboundReceiptLines.id, line.id));

      expect(await readInboundOriginAvailability(tx, key)).toEqual({
        onHandQty: 10,
        pendingQty: -1,
        invalidReceipt: true,
      });
    });
  });

  it.each([
    { quantity: 10, putaway: -1, canceled: 0, returned: 1, pending: 10 },
    { quantity: 10, putaway: 1, canceled: -1, returned: 0, pending: 10 },
    { quantity: 10, putaway: 1, canceled: 0, returned: -1, pending: 10 },
    { quantity: 0, putaway: 0, canceled: 0, returned: 0, pending: 0 },
  ])('상쇄되어 잔량이 정상처럼 보여도 잘못된 개별 수량을 판정한다: %j', async (c) => {
    await inRollbackTx(db, async (tx) => {
      const { warehouse, sku } = await seed(tx);
      const { line, key } = await receiveAtDefault(tx, warehouse.id, sku.id, 10);
      await tx
        .update(wmsTables.inboundReceiptLines)
        .set({
          quantity: c.quantity,
          putawayFromOriginQty: c.putaway,
          canceledQty: c.canceled,
          returnedQty: c.returned,
        })
        .where(eq(wmsTables.inboundReceiptLines.id, line.id));

      expect(await readInboundOriginAvailability(tx, key)).toEqual({
        onHandQty: 10,
        pendingQty: c.pending,
        invalidReceipt: true,
      });
    });
  });

  it('회차 창고와 맞지 않는 원위치는 invalidReceipt로 보고한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouse, otherWarehouse, sku, otherSku } = await seed(tx);
      const { line } = await receiveAtDefault(tx, warehouse.id, sku.id, 10);
      const foreign = await receiveAtDefault(tx, otherWarehouse.id, otherSku.id, 1);
      await tx
        .update(wmsTables.inboundReceiptLines)
        .set({ originLocationId: foreign.key.sourceLocationId })
        .where(eq(wmsTables.inboundReceiptLines.id, line.id));
      const key = {
        skuId: sku.id,
        warehouseId: warehouse.id,
        sourceLocationId: foreign.key.sourceLocationId,
      };

      expect(await readInboundOriginAvailability(tx, key)).toEqual({
        onHandQty: 0,
        pendingQty: 0,
        invalidReceipt: true,
      });
    });
  });

  it('입고 라인과 무관한 회수 재고는 일반 가용 재고다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouse, sku } = await seed(tx);
      await receiveAtDefault(tx, warehouse.id, sku.id, 1);
      const [rework] = await tx
        .select()
        .from(wmsTables.locations)
        .where(
          and(eq(wmsTables.locations.warehouseId, warehouse.id), eq(wmsTables.locations.systemRole, 'outbound_rework')),
        )
        .limit(1);
      const key = { skuId: sku.id, warehouseId: warehouse.id, sourceLocationId: rework.id };
      await tx.insert(wmsTables.stockLedgers).values({
        skuId: key.skuId,
        warehouseId: key.warehouseId,
        locationId: key.sourceLocationId,
        stockState: 'ON_HAND',
        qty: 5,
      });

      expect(await readInboundOriginAvailability(tx, key)).toEqual({
        onHandQty: 5,
        pendingQty: 0,
        invalidReceipt: false,
      });
      await expect(assertInboundOriginRemovalAllowed(tx, { ...key, quantity: 5 })).resolves.toBeUndefined();
    });
  });

  it('pending을 침범하는 반출만 보호하고 경계까지는 허용한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouse, sku } = await seed(tx);
      const { key } = await receiveAtDefault(tx, warehouse.id, sku.id, 10);
      await setOnHand(tx, key, 12);

      await expect(assertInboundOriginRemovalAllowed(tx, { ...key, quantity: 2 })).resolves.toBeUndefined();
      await expect(assertInboundOriginRemovalAllowed(tx, { ...key, quantity: 3 })).rejects.toMatchObject({
        response: { code: 'INBOUND_ORIGIN_STOCK_PROTECTED' },
      });
    });
  });

  it('invalidReceipt는 원장이 충분해도 inconsistent로 거절한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouse, sku } = await seed(tx);
      const { line, key } = await receiveAtDefault(tx, warehouse.id, sku.id, 10);
      await tx
        .update(wmsTables.inboundReceiptLines)
        .set({ canceledQty: 11 })
        .where(eq(wmsTables.inboundReceiptLines.id, line.id));

      const rejection = assertInboundOriginRemovalAllowed(tx, { ...key, quantity: 0 });
      await expect(rejection).rejects.toBeInstanceOf(ConflictException);
      await expect(rejection).rejects.toMatchObject({
        response: { code: 'INBOUND_ORIGIN_STOCK_INCONSISTENT' },
      });
    });
  });
});
