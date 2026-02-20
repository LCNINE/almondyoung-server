import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { DbModule, DbService } from '@app/db';
import { eq, inArray } from 'drizzle-orm';
import * as dotenv from 'dotenv';
import * as path from 'node:path';
import { WalletSchema, outboxEvents, walletSchema } from '../schema';
import { OutboxDispatcherService } from './outbox-dispatcher.service';

dotenv.config({ path: path.resolve(process.cwd(), 'apps/wallet/.env.test') });
dotenv.config({ path: path.resolve(process.cwd(), 'apps/wallet/.env') });

const DATABASE_URL = process.env.WALLET_TEST_DATABASE_URL;
const RUN_WALLET_DB_TESTS = process.env.RUN_WALLET_DB_TESTS === '1';

if (RUN_WALLET_DB_TESTS && !DATABASE_URL) {
  throw new Error(
    'WALLET_TEST_DATABASE_URL is required when RUN_WALLET_DB_TESTS=1',
  );
}

const describeWithDatabase =
  DATABASE_URL && RUN_WALLET_DB_TESTS ? describe : describe.skip;

jest.setTimeout(30_000);

describeWithDatabase('OutboxDispatcherService (integration)', () => {
  let module: TestingModule;
  let dbService: DbService<WalletSchema>;
  let service: OutboxDispatcherService;
  let publishRawEnvelope: jest.Mock;
  const insertedIds: string[] = [];

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        DbModule.forRoot({
          config: {
            connectionString: DATABASE_URL!,
          },
          schema: walletSchema,
        }),
      ],
    }).compile();

    dbService = module.get<DbService<WalletSchema>>(DbService);
    publishRawEnvelope = jest.fn().mockResolvedValue(undefined);
    service = new OutboxDispatcherService(dbService, {
      publishRawEnvelope,
    } as never);
  });

  beforeEach(() => {
    publishRawEnvelope.mockClear();
  });

  afterEach(async () => {
    if (insertedIds.length === 0) {
      return;
    }
    await dbService.db.delete(outboxEvents).where(inArray(outboxEvents.id, insertedIds));
    insertedIds.splice(0, insertedIds.length);
  });

  afterAll(async () => {
    await module.close();
  });

  it('allows same-partition follow-up publish when previous event is DEAD_LETTER', async () => {
    const partitionKey = `outbox-it-${randomUUID()}`;
    const firstCreatedAt = new Date('2026-02-01T00:00:00.000Z');
    const secondCreatedAt = new Date('2026-02-01T00:00:01.000Z');

    const [deadLetterEvent] = await dbService.db
      .insert(outboxEvents)
      .values({
        messageId: `msg-${randomUUID()}`,
        eventType: 'PaymentIntentSucceeded',
        aggregateType: 'PaymentIntent',
        aggregateId: randomUUID(),
        partitionKey,
        payload: buildPaymentIntentSucceededPayload(),
        status: 'DEAD_LETTER',
        attempts: 10,
        deadLetteredAt: new Date(),
        deadLetterReason: 'poison event',
        createdAt: firstCreatedAt,
        updatedAt: firstCreatedAt,
      })
      .returning({ id: outboxEvents.id });
    insertedIds.push(deadLetterEvent.id);

    const [pendingEvent] = await dbService.db
      .insert(outboxEvents)
      .values({
        messageId: `msg-${randomUUID()}`,
        eventType: 'PaymentIntentSucceeded',
        aggregateType: 'PaymentIntent',
        aggregateId: randomUUID(),
        partitionKey,
        payload: buildPaymentIntentSucceededPayload(),
        status: 'PENDING',
        attempts: 0,
        createdAt: secondCreatedAt,
        updatedAt: secondCreatedAt,
      })
      .returning({ id: outboxEvents.id });
    insertedIds.push(pendingEvent.id);

    await service.dispatchPendingEvents();

    expect(publishRawEnvelope).toHaveBeenCalledTimes(1);
    const rows = await dbService.db
      .select({
        id: outboxEvents.id,
        status: outboxEvents.status,
      })
      .from(outboxEvents)
      .where(inArray(outboxEvents.id, [deadLetterEvent.id, pendingEvent.id]));

    const byId = new Map(rows.map((row) => [row.id, row.status]));
    expect(byId.get(deadLetterEvent.id)).toBe('DEAD_LETTER');
    expect(byId.get(pendingEvent.id)).toBe('PUBLISHED');
  });

  it('keeps partition order by blocking later PENDING event behind older PENDING event', async () => {
    const partitionKey = `outbox-it-${randomUUID()}`;
    const firstCreatedAt = new Date('2026-02-01T00:10:00.000Z');
    const secondCreatedAt = new Date('2026-02-01T00:10:01.000Z');

    const [firstPending] = await dbService.db
      .insert(outboxEvents)
      .values({
        messageId: `msg-${randomUUID()}`,
        eventType: 'PaymentIntentSucceeded',
        aggregateType: 'PaymentIntent',
        aggregateId: randomUUID(),
        partitionKey,
        payload: buildPaymentIntentSucceededPayload(),
        status: 'PENDING',
        attempts: 0,
        createdAt: firstCreatedAt,
        updatedAt: firstCreatedAt,
      })
      .returning({ id: outboxEvents.id });
    insertedIds.push(firstPending.id);

    const [secondPending] = await dbService.db
      .insert(outboxEvents)
      .values({
        messageId: `msg-${randomUUID()}`,
        eventType: 'PaymentIntentSucceeded',
        aggregateType: 'PaymentIntent',
        aggregateId: randomUUID(),
        partitionKey,
        payload: buildPaymentIntentSucceededPayload(),
        status: 'PENDING',
        attempts: 0,
        createdAt: secondCreatedAt,
        updatedAt: secondCreatedAt,
      })
      .returning({ id: outboxEvents.id });
    insertedIds.push(secondPending.id);

    await service.dispatchPendingEvents();

    expect(publishRawEnvelope).toHaveBeenCalledTimes(1);
    const [firstRow] = await dbService.db
      .select({
        status: outboxEvents.status,
      })
      .from(outboxEvents)
      .where(eq(outboxEvents.id, firstPending.id))
      .limit(1);
    const [secondRow] = await dbService.db
      .select({
        status: outboxEvents.status,
      })
      .from(outboxEvents)
      .where(eq(outboxEvents.id, secondPending.id))
      .limit(1);

    expect(firstRow?.status).toBe('PUBLISHED');
    expect(secondRow?.status).toBe('PENDING');
  });
});

function buildPaymentIntentSucceededPayload() {
  return {
    intentId: randomUUID(),
    referenceType: 'STORE_ORDER',
    referenceId: `order-${randomUUID()}`,
    userId: `customer-${randomUUID()}`,
    status: 'SUCCEEDED',
    payableAmount: 1000,
    currency: 'KRW',
    occurredAt: new Date().toISOString(),
  };
}
