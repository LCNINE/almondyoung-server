import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { makeDbService } from '../../fulfillment/services/__support__';
import { wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { SalesOrdersService } from './sales-orders.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('주문 메모 저장 (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let service: SalesOrdersService;
  let id: string;
  const enqueue = jest.fn();

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 4 });
    db = drizzle(client, { schema: wmsSchema });
    const unused = {} as never;
    service = new SalesOrdersService(makeDbService(db), { enqueue } as never, unused, unused, unused, unused);
    jest.spyOn(service, 'getOne').mockResolvedValue({} as never);
  });
  beforeEach(async () => {
    enqueue.mockReset();
    const [so] = await db
      .insert(wmsTables.salesOrders)
      .values({
        channelOrderId: `MEMO-${randomUUID()}`,
        salesChannel: 'medusa',
        status: 'pending',
        shippingAddress: {},
        orderDate: new Date(),
      })
      .returning();
    id = so.id;
  });
  afterEach(async () => {
    await db.delete(wmsTables.salesOrders).where(eq(wmsTables.salesOrders.id, id));
  });
  afterAll(async () => {
    await client.end();
  });

  const memo = async () => {
    const [row] = await db
      .select({ memo: wmsTables.salesOrders.memo })
      .from(wmsTables.salesOrders)
      .where(eq(wmsTables.salesOrders.id, id));
    return row.memo;
  };

  it('본 메모가 그대로면 저장하고, 비어 있던 메모(null)는 빈 문자열과 같다', async () => {
    await service.update(id, { memo: '첫 메모', expectedMemo: '' });
    expect(await memo()).toBe('첫 메모');
    await service.update(id, { memo: '둘째', expectedMemo: '첫 메모' });
    expect(await memo()).toBe('둘째');
    expect(enqueue).toHaveBeenCalledTimes(2);
  });

  it('동시에 같은 메모를 보고 고치면 한 명만 저장되고 다른 한 명은 409 — 이벤트도 한 번', async () => {
    const results = await Promise.allSettled([
      service.update(id, { memo: 'A', expectedMemo: '' }),
      service.update(id, { memo: 'B', expectedMemo: '' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason.message).toContain('다른 사람이 메모를 바꿨습니다');
    expect(await memo()).toBe(results[0].status === 'fulfilled' ? 'A' : 'B');
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('본 메모를 보내지 않는 호출은 지금처럼 덮어쓴다', async () => {
    await service.update(id, { memo: 'A' });
    await service.update(id, { memo: 'B' });
    expect(await memo()).toBe('B');
  });
});
