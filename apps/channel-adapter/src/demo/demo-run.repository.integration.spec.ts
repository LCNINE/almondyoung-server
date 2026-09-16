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
import type { DemoCatalogClient, DemoCatalogItem } from './demo-catalog.client';

const trustedCatalog: DemoCatalogItem[] = [
  {
    variantId: '019f1003-0030-7000-a000-000000000030',
    masterId: '019f1001-0030-7000-a000-000000000030',
    versionId: '019f1002-0030-7000-a000-000000000030',
    skuId: '019f1004-0030-7000-a000-000000000030',
    sku: 'DEMO-SKU-030',
    productName: '데모 물류 상품 30',
    unitPrice: 10000,
    availableQuantity: 100,
    components: [{ skuId: '019f1004-0030-7000-a000-000000000030', quantity: 1, availableQuantity: 100 }],
  },
  {
    variantId: '019f1003-0001-7000-a000-000000000001',
    masterId: '019f1001-0001-7000-a000-000000000001',
    versionId: '019f1002-0001-7000-a000-000000000001',
    skuId: '019f1004-0001-7000-a000-000000000001',
    sku: 'DEMO-SKU-001',
    productName: '데모 물류 상품 01',
    unitPrice: 20000,
    availableQuantity: 100,
    components: [{ skuId: '019f1004-0001-7000-a000-000000000001', quantity: 1, availableQuantity: 100 }],
  },
];

function catalogClient(items = trustedCatalog): DemoCatalogClient {
  return { list: jest.fn(() => Promise.resolve(items)) } as unknown as DemoCatalogClient;
}

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
    service = new DemoRunService(repository, catalogClient());
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
      'Bearer test',
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
      'Bearer test',
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
      service.create({ requestId, scenario: 'happy_path', count: 1 }, 'actor-a', 'Bearer test'),
      service.create({ requestId, scenario: 'inventory_shortage', count: 1 }, 'actor-b', 'Bearer test'),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(rejected?.reason).toBeInstanceOf(ConflictException);
    const rows = await dbService.db.select().from(demoRuns).where(eq(demoRuns.requestId, requestId));
    expect(rows).toHaveLength(1);
  });

  it('persists and hydrates trusted multi-product lines before ingestion', async () => {
    const request = {
      requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      scenario: 'happy_path' as const,
      count: 1,
      mode: 'specified' as const,
      variantIds: trustedCatalog.map((item) => item.variantId),
      productsPerOrder: 2,
      minQuantity: 2,
      maxQuantity: 2,
    };

    const first = await service.create(request, 'actor', 'Bearer token');
    const replay = await service.create(request, 'actor', 'Bearer token');
    const persistedItems = await dbService.db.select().from(demoRunItems).where(eq(demoRunItems.runId, first.id));

    expect(new Set(first.items[0].lines.map((line) => line.variantId)).size).toBe(2);
    expect(persistedItems[0].lines).toEqual(first.items[0].lines);
    expect(replay.items[0].lines).toEqual(first.items[0].lines);
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
    const realService = new DemoRunService(new DemoRunRepository(dbService, orchestrator), catalogClient());
    const request = {
      requestId: '44444444-4444-4444-8444-444444444444',
      scenario: 'happy_path' as const,
      count: 1,
    };

    const first = await realService.create(request, 'actor', 'Bearer test');
    const replay = await realService.create(request, 'actor', 'Bearer test');
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

  it('hydrates pre-migration rows with legacy fixture input and line identity', async () => {
    const requestId = '99999999-9999-4999-8999-999999999991';
    await dbService.db.insert(demoRuns).values({
      id: requestId,
      requestId,
      inputHash: 'a'.repeat(64),
      fixtureVersion: 'demo-logistics-v1',
      scenario: 'happy_path',
      status: 'completed',
      requestedCount: 1,
      variantId: trustedCatalog[0].variantId,
      quantity: 2,
      requestedBy: 'legacy-actor',
    });
    await dbService.db.insert(demoRunItems).values({
      id: '99999999-9999-4999-8999-999999999992',
      runId: requestId,
      sequence: 1,
      externalOrderId: `demo-${requestId}-001`,
      orderId: '99999999-9999-4999-8999-999999999993',
      status: 'enqueued',
      attempts: 1,
    });

    const hydrated = await new DemoRunRepository(dbService, {} as never).getById(requestId);

    expect(hydrated?.input).toMatchObject({
      mode: 'specified',
      variantIds: [trustedCatalog[0].variantId],
      productsPerOrder: 1,
      minQuantity: 2,
      maxQuantity: 2,
    });
    expect(hydrated?.items[0].lines).toEqual([
      expect.objectContaining({ variantId: trustedCatalog[0].variantId, quantity: 2 }),
    ]);

    const list = jest.fn(() => Promise.reject(new Error('legacy replay must not query catalog')));
    const replay = await new DemoRunService(new DemoRunRepository(dbService, {} as never), {
      list,
    } as unknown as DemoCatalogClient).create(
      {
        requestId,
        scenario: 'happy_path',
        count: 1,
        mode: 'specified',
        variantIds: [trustedCatalog[0].variantId],
        productsPerOrder: 1,
        minQuantity: 2,
        maxQuantity: 2,
      },
      'legacy-actor',
      'Bearer token',
    );
    expect(replay.id).toBe(requestId);
    expect(list).not.toHaveBeenCalled();
  });
});
