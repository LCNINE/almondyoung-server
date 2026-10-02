/**
 * 같은 멱등 키로 두 번 요청하면 채널별로 한 번만 만들고 한 번만 큐에 넣는다 — 실제 Postgres 통합.
 *
 * 충돌 판정은 부분 유니크 인덱스가 하므로 목으로는 확인할 수 없다.
 * DATABASE_URL 이 없으면 통째로 skip 된다.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- postgres publishes `export =`; Jest compiles CJS.
import postgres = require('postgres');
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../../../database/schemas/notification-schema';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { TemplateVariableMapperService } from '../../shared/services/template-variable-mapper.service';
import { Channel, NotificationCategory } from '../../shared/enums';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('NotificationDispatcherService 멱등 키 (PostgreSQL 통합)', () => {
  jest.setTimeout(60_000);

  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let dispatcher: NotificationDispatcherService;
  const queue = { add: jest.fn() };
  const userId = `it-idem-${Date.now()}`;

  const request = (idempotencyKey?: string) =>
    dispatcher.send({
      userId,
      channels: [Channel.SMS, Channel.KAKAO],
      category: NotificationCategory.TRANSACTIONAL,
      content: { SMS: { body: '본문' }, KAKAO: { body: '본문' } },
      payload: { phoneNumber: '01000000000' },
      idempotencyKey,
    });

  beforeAll(async () => {
    client = postgres(DATABASE_URL as string, { max: 2, prepare: false });
    db = drizzle(client, { schema });
    dispatcher = new NotificationDispatcherService(
      { db } as never,
      queue as never,
      new TemplateVariableMapperService(),
      null as never,
      null as never,
      null as never,
    );
  });

  beforeEach(() => queue.add.mockClear());

  afterAll(async () => {
    await db.delete(schema.notifications).where(eq(schema.notifications.userId, userId));
    await client.end();
  });

  it('같은 키로 두 번 보내면 채널마다 한 행·한 번만 큐에 넣고, 두 번째도 같은 id 를 돌려준다', async () => {
    const key = `it-idem-key-${Date.now()}`;

    const first = await request(key);
    const second = await request(key);

    const rows = await db.select().from(schema.notifications).where(eq(schema.notifications.idempotencyKey, key));
    expect(rows).toHaveLength(2);
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(second.notificationIds.sort()).toEqual(first.notificationIds.sort());
  });

  it('키가 없는 요청은 지금처럼 매번 새로 만든다', async () => {
    await request();
    await request();

    expect(queue.add).toHaveBeenCalledTimes(4);
  });
});
