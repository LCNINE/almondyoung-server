import { inArray } from 'drizzle-orm';
import { DbService } from '@app/db';
import { channelAdapterSchema, inboxEvents } from '../../schema';
import { SellableSettleGate } from './sellable-settle-gate';

/**
 * 실행: dotenv -e apps/channel-adapter/.env -- npx jest --runInBand apps/channel-adapter/src/services/reservation-projection/sellable-settle-gate.integration.spec.ts
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('SellableSettleGate (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  let dbService: DbService<typeof channelAdapterSchema>;
  let gate: SellableSettleGate;
  const now = new Date('2026-11-10T01:00:00Z');
  const asOf = new Date('2026-11-10T00:00:00Z');
  const ids = ['gate-v-pending', 'gate-v-processing', 'gate-v-failed', 'gate-v-published', 'gate-v-none'];

  const insert = (aggregateId: string, status: string, eventType = 'ProductSellableQuantityChanged') =>
    dbService.db.insert(inboxEvents).values({
      eventType,
      aggregateType: 'Variant',
      aggregateId,
      partitionKey: aggregateId,
      payload: {},
      status,
    });

  beforeAll(() => {
    dbService = new DbService({ connectionString: DATABASE_URL as string }, channelAdapterSchema);
    gate = new SellableSettleGate(dbService, { get: (_k: string, d: number) => d } as never);
  });
  beforeEach(async () => {
    await dbService.db.delete(inboxEvents).where(inArray(inboxEvents.aggregateId, ids));
    await insert('gate-v-pending', 'pending');
    await insert('gate-v-processing', 'processing');
    await insert('gate-v-failed', 'failed');
    await insert('gate-v-published', 'published');
    await insert('gate-v-none', 'pending', 'SomethingElse');
  });
  afterAll(async () => {
    await dbService.db.delete(inboxEvents).where(inArray(inboxEvents.aggregateId, ids));
    await dbService.onApplicationShutdown();
  });

  it('pending·processing 만 막고 failed·published·다른 이벤트는 막지 않는다', async () => {
    await expect(gate.blockedVariantIds(ids, asOf, now)).resolves.toEqual(
      new Set(['gate-v-pending', 'gate-v-processing']),
    );
  });
});
