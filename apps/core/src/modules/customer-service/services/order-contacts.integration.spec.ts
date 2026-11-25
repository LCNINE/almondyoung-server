import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbService } from '@app/db';
import { mergedSchema, type MergedSchema } from '../../../platform/database/merged-schema';
import { wmsTables } from '../../inventory/schema/inventory.schema';
import { CreateOrderContactDto } from '../dto/order-contact.dto';
import { salesOrderContacts } from '../schema/customer-service.schema';
import { OrderContactsManager } from './order-contacts.manager';
import { OrderContactsReader } from './order-contacts.reader';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('연락 기록 (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<MergedSchema>;
  let manager: OrderContactsManager;
  let reader: OrderContactsReader;
  let salesOrderId: string;
  const now = new Date('2026-11-24T16:00:00Z'); // 한국 11월 25일 01시

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 4 });
    db = drizzle(client, { schema: mergedSchema });
    const dbService = {
      db,
      run: (fn: (tx: unknown) => unknown, tx?: unknown) => (tx ? fn(tx) : db.transaction(fn as never)),
    };
    manager = new OrderContactsManager(dbService as unknown as DbService<MergedSchema>);
    reader = new OrderContactsReader(dbService as unknown as DbService<MergedSchema>);
  });
  beforeEach(async () => {
    const [so] = await db
      .insert(wmsTables.salesOrders)
      .values({
        channelOrderId: `OC-${randomUUID()}`,
        salesChannel: 'medusa',
        status: 'pending',
        shippingAddress: {},
        orderDate: now,
      })
      .returning();
    salesOrderId = so.id;
  });
  afterEach(async () => {
    await db.delete(salesOrderContacts).where(eq(salesOrderContacts.salesOrderId, salesOrderId));
    await db.delete(wmsTables.salesOrders).where(eq(wmsTables.salesOrders.id, salesOrderId));
  });
  afterAll(async () => {
    await client.end();
  });

  const dto = (patch: Partial<CreateOrderContactDto> = {}): CreateOrderContactDto => ({
    id: randomUUID(),
    salesOrderId,
    outcome: 'reached',
    body: ' 부분 발송 동의 ',
    followUpOn: null,
    ...patch,
  });

  it('두 사람이 동시에 남기면 둘 다 남고 최근 것부터 나온다', async () => {
    const [a, b] = [randomUUID(), randomUUID()];
    await Promise.all([manager.create(dto({ body: 'A' }), a, now), manager.create(dto({ body: 'B' }), b, now)]);
    const rows = await reader.list(salesOrderId);
    expect(rows.map((r) => r.body).sort()).toEqual(['A', 'B']);
    expect(rows[0].createdAt.getTime()).toBeGreaterThanOrEqual(rows[1].createdAt.getTime());
  });

  it('같은 요청을 순서대로·동시에 다시 보내도 한 행이다', async () => {
    const author = randomUUID();
    const request = dto();
    const results = await Promise.all(Array.from({ length: 4 }, () => manager.create(request, author, now)));
    const again = await manager.create(request, author, now);
    expect(new Set([...results, again].map((r) => r.createdAt.getTime())).size).toBe(1);
    expect(await reader.list(salesOrderId)).toMatchObject([{ body: '부분 발송 동의', authorId: author }]);
  });

  it('다시 보낸 때가 다음 날이라 날짜가 지났어도 이미 저장된 요청은 그대로 성공한다', async () => {
    const author = randomUUID();
    const request = dto({ followUpOn: '2026-11-25' });
    await manager.create(request, author, now);
    const later = await manager.create(request, author, new Date('2026-11-27T00:00:00Z'));
    expect(later.followUpOn).toBe('2026-11-25');
  });

  it('같은 id 로 다른 내용·다른 사람이 오면 409 — 남의 기록으로 바꿔치지 않는다', async () => {
    const author = randomUUID();
    const request = dto();
    await manager.create(request, author, now);
    await expect(manager.create({ ...request, outcome: 'no_answer' }, author, now)).rejects.toThrow('이미 다른 내용');
    await expect(manager.create(request, randomUUID(), now)).rejects.toThrow('이미 다른 내용');
    expect(await reader.list(salesOrderId)).toHaveLength(1);
  });

  it('다시 연락할 날은 한국 날짜로 오늘부터 — 어제·없는 날은 거절한다', async () => {
    const author = randomUUID();
    await expect(manager.create(dto({ followUpOn: '2026-11-24' }), author, now)).rejects.toThrow('오늘이나 그 뒤');
    await expect(manager.create(dto({ followUpOn: '2027-02-30' }), author, now)).rejects.toThrow('달력에 없는');
    await expect(manager.create(dto({ followUpOn: '2026-11-25' }), author, now)).resolves.toMatchObject({
      followUpOn: '2026-11-25',
    });
  });

  it('없는 주문에는 남기지 않는다', async () => {
    await expect(manager.create(dto({ salesOrderId: randomUUID() }), randomUUID(), now)).rejects.toThrow('not found');
  });
});
