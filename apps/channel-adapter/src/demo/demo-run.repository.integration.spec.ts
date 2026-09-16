import { ConflictException } from '@nestjs/common';
import { DbService } from '@app/db';
import { OutboxPublisher, StreamPublisher } from '@app/events';
import { outbox_events } from '@app/events';
import { ORDER_STREAM } from '@packages/event-contracts/streams';
import { eq } from 'drizzle-orm';
import {
  channelAdapterSchema,
  channelDispatchOperations,
  demoRunItems,
  demoRuns,
  inboxEvents,
  orderCollectionFailures,
  pollingChangeHashes,
  wmsOrderMappings,
} from '../schema';
import { OrderCollectionFailureService } from '../services/order-collection/order-collection-failure.service';
import type { ChannelOrderProvider } from '../services/order-collection/channel-order-provider.interface';
import { OrderPollerOrchestrator } from '../services/order-collection/order-poller.orchestrator';
import { PollingChangeHashService } from '../services/polling-change-hash.service';
import { DemoRunRepository } from './demo-run.repository';
import { DemoRunService } from './demo-run.service';
import { DemoDispatchOutcomeReader } from './demo-dispatch-outcome.reader';

const describeIntegration = process.env.REQUIRE_DEMO_CHANNEL_DB === '1' ? describe : describe.skip;
const connectionString =
  process.env.DEMO_CHANNEL_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/demo_channel_adapter_scratch';

describeIntegration('DemoRunRepository integration', () => {
  let dbService: DbService<typeof channelAdapterSchema>;
  let failSecondItem: boolean;
  let service: DemoRunService;

  beforeAll(() => {
    dbService = new DbService({ connectionString }, channelAdapterSchema);
  });

  beforeEach(async () => {
    await dbService.db.delete(channelDispatchOperations);
    await dbService.db.delete(inboxEvents);
    await dbService.db.delete(demoRunItems);
    await dbService.db.delete(demoRuns);
    await dbService.db.delete(wmsOrderMappings);
    await dbService.db.delete(pollingChangeHashes);
    await dbService.db.delete(orderCollectionFailures);
    await dbService.db.delete(outbox_events);
    failSecondItem = false;
    const orderPoller = {
      ingestProvider: jest.fn(async (provider: ChannelOrderProvider) => {
        const [order] = (await provider.fetchOrders(null)).orders;
        if (failSecondItem && order.externalOrderId.endsWith('-002')) {
          throw new Error('simulated transient enqueue failure');
        }
        return [
          {
            externalOrderId: order.externalOrderId,
            orderId: order.createPayload.orderId,
            enqueued: true,
          },
        ];
      }),
    };
    const repository = new DemoRunRepository(dbService, orderPoller as never);
    service = new DemoRunService(repository);
  });

  afterAll(async () => {
    await dbService.onApplicationShutdown();
  });

  it('persists a partial failure and resumes only the failed item on replay', async () => {
    const requestId = '11111111-1111-4111-8111-111111111111';
    failSecondItem = true;

    const partial = await service.create(
      { requestId, scenario: 'happy_path', count: 2 },
      '22222222-2222-4222-8222-222222222222',
    );

    expect(partial.status).toBe('partial_failure');
    expect(partial.items.map((item) => [item.status, item.attempts])).toEqual([
      ['enqueued', 1],
      ['failed', 1],
    ]);

    failSecondItem = false;
    const completed = await service.create(
      {
        requestId,
        scenario: 'happy_path',
        count: 2,
        variantId: partial.variantId,
        quantity: partial.quantity,
      },
      '22222222-2222-4222-8222-222222222222',
    );

    expect(completed.status).toBe('completed');
    expect(completed.items.map((item) => [item.status, item.attempts])).toEqual([
      ['enqueued', 1],
      ['enqueued', 2],
    ]);
  });

  it('allows exactly one concurrent conflicting input for a request id', async () => {
    const requestId = '33333333-3333-4333-8333-333333333333';
    const results = await Promise.allSettled([
      service.create({ requestId, scenario: 'happy_path', count: 1 }, 'actor-a'),
      service.create({ requestId, scenario: 'inventory_shortage', count: 1 }, 'actor-b'),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(rejected?.reason).toBeInstanceOf(ConflictException);
    const rows = await dbService.db.select().from(demoRuns).where(eq(demoRuns.requestId, requestId));
    expect(rows).toHaveLength(1);
  });

  it('writes one schema-valid confirmed OrderCreated through the real transactional outbox path', async () => {
    const outboxWriter = new OutboxPublisher(dbService as unknown as DbService);
    const publisher = new StreamPublisher(
      { send: () => Promise.resolve() },
      ORDER_STREAM,
      'channel-adapter-demo-test',
      { validateOnPublish: true, throwOnValidationError: true },
      undefined,
      undefined,
      outboxWriter,
    );
    const orchestrator = new OrderPollerOrchestrator(
      [],
      {} as never,
      publisher,
      new PollingChangeHashService(dbService),
      new OrderCollectionFailureService(dbService),
      dbService,
      {} as never,
    );
    const realService = new DemoRunService(new DemoRunRepository(dbService, orchestrator));
    const request = {
      requestId: '44444444-4444-4444-8444-444444444444',
      scenario: 'happy_path' as const,
      count: 1,
    };

    const first = await realService.create(request, 'actor');
    const replay = await realService.create(request, 'actor');
    const rows = await dbService.db.select().from(outbox_events);

    expect(first.status).toBe('completed');
    expect(replay.id).toBe(first.id);
    expect(replay.updatedAt).toEqual(first.updatedAt);
    expect(replay.completedAt).toEqual(first.completedAt);
    expect(rows).toHaveLength(1);
    const envelope = rows[0].payload as { messageType: string; payload: unknown };
    expect(envelope.messageType).toBe('OrderCreated');
    expect(ORDER_STREAM.events.OrderCreated.schema?.safeParse(envelope.payload)).toEqual(
      expect.objectContaining({ success: true }),
    );
    expect(envelope.payload).toEqual(
      expect.objectContaining({
        orderId: first.items[0].orderId,
        externalOrderId: first.items[0].externalOrderId,
        salesChannel: 'medusa',
        status: 'confirmed',
      }),
    );
  });

  it('lists persisted mock channel dispatch outcomes for the demo console', async () => {
    const inboxEventId = '55555555-5555-4555-8555-555555555555';
    const attemptId = '66666666-6666-4666-8666-666666666666';
    const orderId = '77777777-7777-4777-8777-777777777777';
    await dbService.db.insert(inboxEvents).values({
      id: inboxEventId,
      eventType: 'ShipmentShipped',
      aggregateType: 'shipment',
      aggregateId: attemptId,
      partitionKey: orderId,
      payload: {},
      status: 'published',
    });
    await dbService.db.insert(channelDispatchOperations).values({
      inboxEventId,
      dispatchAttemptId: attemptId,
      shipmentId: '88888888-8888-4888-8888-888888888888',
      salesOrderId: orderId,
      operation: 'dispatch',
      channel: 'medusa',
      externalOrderId: 'demo-order-1',
      providerIdempotencyKey: `shipment:${attemptId}:${orderId}:dispatch`,
      requestSnapshot: { eventType: 'ShipmentShipped' },
      status: 'succeeded',
      attempts: 1,
      resultSnapshot: { mocked: true, mode: 'demo' },
    });

    const result = await new DemoDispatchOutcomeReader(dbService).list(20);

    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      attemptId,
      shipmentId: '88888888-8888-4888-8888-888888888888',
      orderId,
      externalOrderId: 'demo-order-1',
      operation: 'dispatch',
      channel: 'medusa',
      status: 'succeeded',
      attempts: 1,
      error: null,
      result: { mocked: true, mode: 'demo' },
    });
  });
});
