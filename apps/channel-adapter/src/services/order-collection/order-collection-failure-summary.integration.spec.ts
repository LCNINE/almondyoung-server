// eslint-disable-next-line @typescript-eslint/no-require-imports -- postgres publishes `export =`; Jest compiles CJS.
import postgres = require('postgres');
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, sql } from 'drizzle-orm';
import { OrderCollectionFailureService } from './order-collection-failure.service';
import { CHANNEL_PRODUCT_IDENTIFICATION_FAILED } from './channel-order-provider.interface';
import { orderCollectionFailures } from '../../schema';

/**
 * 실행:
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/channel_adapter \
 *   npx jest --runInBand apps/channel-adapter/src/services/order-collection/order-collection-failure-summary.integration.spec.ts
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('격리 요약 (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;
  let service: OrderCollectionFailureService;
  const channel = `spec-${Math.random().toString(36).slice(2, 10)}`;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 2, prepare: false });
    db = drizzle(client);
    service = new OrderCollectionFailureService({ db } as never);
  });
  afterAll(async () => {
    await db.delete(orderCollectionFailures).where(eq(orderCollectionFailures.channel, channel));
    await client.end({ timeout: 0 });
  });

  const insert = (externalOrderId: string, status: string, createdAt: string) =>
    db.insert(orderCollectionFailures).values({
      channel,
      externalOrderId,
      reason: CHANNEL_PRODUCT_IDENTIFICATION_FAILED,
      affectedLineIds: [],
      rawOrder: {},
      sourceUpdatedAt: new Date(),
      status,
      createdAt: sql`${createdAt}::timestamp`,
    });

  it('quarantined 만 세고 가장 이른 created_at 을 준다', async () => {
    await insert('A', 'quarantined', '2026-10-01 00:00:00');
    await insert('B', 'quarantined', '2026-10-03 00:00:00');
    await insert('C', 'replayed', '2026-09-01 00:00:00');

    await expect(service.summarizeQuarantined({ channel })).resolves.toEqual({
      quarantined: 2,
      oldestCreatedAt: '2026-10-01T00:00:00.000Z',
    });
  });

  it('없으면 0 과 null', async () => {
    await expect(service.summarizeQuarantined({ channel: `${channel}-none` })).resolves.toEqual({
      quarantined: 0,
      oldestCreatedAt: null,
    });
  });
});
