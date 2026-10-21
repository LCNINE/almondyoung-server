import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as postgres from 'postgres';
import {
  seedFo,
  seedOrder,
  seedWorld,
} from '../../../apps/core/src/modules/fulfillment/order-progress/__support__/order-progress.fixtures';
import { DbTx, wmsSchema, wmsTables } from '../../../apps/core/src/modules/inventory/schema/inventory.schema';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sqlText: {
  MARK_SALES_ORDERS_SHIPPED: string;
  MARK_FULFILLMENT_ORDERS_SHIPPED: string;
  MARK_FULFILLMENT_ORDER_ITEMS_SHIPPED: string;
} = require('./mark-core-shipped.sql.js');

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('mark-core-shipped.js — 취소된 FO·FOI 를 출고로 덮지 않는다 (K6 PR2b, F12)', () => {
  jest.setTimeout(120_000);
  const client = postgres(DATABASE_URL as string, { max: 1 });
  afterAll(async () => {
    await client.end();
  });

  /**
   * 한 트랜잭션 안에서 시드하고 스크립트의 UPDATE 셋을 그대로 실행한 뒤 롤백한다.
   * 연결이 하나(max: 1)라 BEGIN/ROLLBACK 이 drizzle 과 `unsafe` 둘 다에 걸린다.
   */
  async function inTx(fn: (tx: DbTx, run: (channelOrderId: string) => Promise<void>) => Promise<void>): Promise<void> {
    const tx = drizzle(client, { schema: wmsSchema }) as unknown as DbTx;
    const run = async (channelOrderId: string): Promise<void> => {
      await client.unsafe(sqlText.MARK_SALES_ORDERS_SHIPPED, [[channelOrderId]]);
      await client.unsafe(sqlText.MARK_FULFILLMENT_ORDERS_SHIPPED, [[channelOrderId]]);
      await client.unsafe(sqlText.MARK_FULFILLMENT_ORDER_ITEMS_SHIPPED, [[channelOrderId]]);
    };
    await client.unsafe('BEGIN');
    try {
      await fn(tx, run);
    } finally {
      await client.unsafe('ROLLBACK');
    }
  }

  async function channelOrderIdOf(tx: DbTx, salesOrderId: string): Promise<string> {
    const [so] = await tx.select().from(wmsTables.salesOrders).where(eq(wmsTables.salesOrders.id, salesOrderId));
    return so.channelOrderId;
  }

  async function readFo(tx: DbTx, foId: string, foItemId: string) {
    const [fo] = await tx.select().from(wmsTables.fulfillmentOrders).where(eq(wmsTables.fulfillmentOrders.id, foId));
    const [item] = await tx
      .select()
      .from(wmsTables.fulfillmentOrderItems)
      .where(eq(wmsTables.fulfillmentOrderItems.id, foItemId));
    return { fo, item };
  }

  it('canceled fo and its items are not marked shipped', async () => {
    await inTx(async (tx, run) => {
      const w = await seedWorld(tx);
      const order = await seedOrder(tx, { status: 'pending' });
      const { foId, foItemId } = await seedFo(tx, w, order, { qty: 1 });
      await tx
        .update(wmsTables.fulfillmentOrders)
        .set({ status: 'canceled' })
        .where(eq(wmsTables.fulfillmentOrders.id, foId));

      await run(await channelOrderIdOf(tx, order.salesOrderId));

      const { fo, item } = await readFo(tx, foId, foItemId);
      expect(fo.status).toBe('canceled');
      expect(item.shippedQty).toBe(0);
    });
  });

  it('v2 canceled quantity is not marked shipped', async () => {
    await inTx(async (tx, run) => {
      const w = await seedWorld(tx);
      const order = await seedOrder(tx, { status: 'pending', quantity: 2 });
      const { foId, foItemId } = await seedFo(tx, w, order, { qty: 2 });
      await tx
        .update(wmsTables.fulfillmentOrderItems)
        .set({ canceledQty: 1 })
        .where(eq(wmsTables.fulfillmentOrderItems.id, foItemId));

      await run(await channelOrderIdOf(tx, order.salesOrderId));

      const { item } = await readFo(tx, foId, foItemId);
      expect(item.shippedQty).toBe(1);
    });
  });

  it('ordinary order is marked shipped', async () => {
    await inTx(async (tx, run) => {
      const w = await seedWorld(tx);
      const order = await seedOrder(tx, { status: 'pending', quantity: 2 });
      const { foId, foItemId } = await seedFo(tx, w, order, { status: 'ready', qty: 2 });

      await run(await channelOrderIdOf(tx, order.salesOrderId));

      const [so] = await tx
        .select()
        .from(wmsTables.salesOrders)
        .where(eq(wmsTables.salesOrders.id, order.salesOrderId));
      const { fo, item } = await readFo(tx, foId, foItemId);
      expect(so.status).toBe('shipped');
      expect(fo.status).toBe('shipped');
      expect(fo.shippedAt).not.toBeNull();
      expect(item.shippedQty).toBe(2);
      expect(item.status).toBe('shipped');
    });
  });
});
