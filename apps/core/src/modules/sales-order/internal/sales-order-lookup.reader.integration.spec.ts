// eslint-disable-next-line @typescript-eslint/no-require-imports -- postgres publishes `export =`; Jest compiles CJS.
import postgres = require('postgres');
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, inArray } from 'drizzle-orm';
import { dead_letters } from '@app/events';
import { ORDER_STREAM } from '@packages/event-contracts/streams';
import { wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { SalesOrderLookupReader } from './sales-order-lookup.reader';

/**
 * 실행: dotenv -e apps/core/.env -- npx jest --runInBand apps/core/src/modules/sales-order/internal/sales-order-lookup.reader.integration.spec.ts
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('SalesOrderLookupReader (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof wmsSchema>>;
  let reader: SalesOrderLookupReader;
  const suffix = Math.random().toString(36).slice(2, 10);
  const orderA = `spec-lookup-a-${suffix}`;
  const orderB = `spec-lookup-b-${suffix}`;
  const wmsA = `spec-wms-${suffix}`;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 2, prepare: false });
    db = drizzle(client, { schema: wmsSchema });
    reader = new SalesOrderLookupReader({ db } as never);
  });
  afterAll(async () => {
    try {
      await db.delete(wmsTables.salesOrders).where(inArray(wmsTables.salesOrders.channelOrderId, [orderA, orderB]));
      await db.delete(dead_letters).where(eq(dead_letters.sequenceKey, wmsA));
    } finally {
      await client.end({ timeout: 0 });
    }
  });

  it('있는 주문만 상태를 돌려준다', async () => {
    // NOT NULL 이고 기본값 없는 칸은 이 넷뿐이다(inventory.schema.ts 의 salesOrders 정의)
    await db.insert(wmsTables.salesOrders).values({
      channelOrderId: orderA,
      salesChannel: 'medusa',
      status: 'confirmed',
      shippingAddress: {},
      orderDate: new Date(),
    });

    const statuses = await reader.statusesByChannelOrderId('medusa', [orderA, orderB]);
    expect(statuses.get(orderA)).toBe('confirmed');
    expect(statuses.has(orderB)).toBe(false);
  });

  it('주문 생애 토픽의 failed·held 만 열린 실패로 본다', async () => {
    const base = {
      consumerGroup: 'spec',
      handler: 'spec',
      topic: ORDER_STREAM.topic.topic,
      sequenceKey: wmsA,
      envelope: {},
      kafkaPartition: 0,
      kafkaOffset: '0',
    };
    await db.insert(dead_letters).values({ ...base, messageId: `${suffix}-1`, status: 'resolved' });
    await expect(reader.wmsOrderIdsWithOpenEventFailure([wmsA])).resolves.toEqual(new Set());

    await db.insert(dead_letters).values({ ...base, messageId: `${suffix}-2`, status: 'held' });
    await expect(reader.wmsOrderIdsWithOpenEventFailure([wmsA])).resolves.toEqual(new Set([wmsA]));
  });
});
