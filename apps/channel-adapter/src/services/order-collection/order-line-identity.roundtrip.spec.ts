jest.mock('../../adapters/medusa/medusa.client', () => ({
  MedusaClient: class MedusaClient {},
}));

import { ORDER_STREAM, SHIPMENT_STREAM, type OrderCreatedPayload } from '@packages/event-contracts/streams';
import { MedusaOrderProvider } from './medusa-order.provider';
import { OrderPollerOrchestrator } from './order-poller.orchestrator';
import { SalesOrdersService } from '../../../../core/src/modules/sales-order/services/sales-orders.service';
import { wmsTables } from '../../../../core/src/modules/inventory/schema/inventory.schema';

describe('external order-line identity real component round trip', () => {
  it('preserves Medusa line and product IDs through publish, Core storage, and ShipmentShipped', async () => {
    const rawOrderItemId = 'item_medusa_1';
    const rawChannelProductId = 'variant_medusa_1';
    const skuId = '11111111-1111-4111-8111-111111111111';
    const provider = new MedusaOrderProvider({
      listOrders: jest.fn().mockResolvedValue([
        {
          id: 'order_medusa_1',
          payment_status: 'authorized',
          currency_code: 'KRW',
          total: 1000,
          subtotal: 1000,
          shipping_total: 0,
          discount_total: 0,
          created_at: '2026-07-14T01:00:00.000Z',
          updated_at: '2026-07-14T01:01:00.000Z',
          items: [
            {
              id: rawOrderItemId,
              variant_id: rawChannelProductId,
              title: 'Round-trip product',
              quantity: 1,
              unit_price: 1000,
              variant: {
                metadata: { pimVariantId: skuId },
                product: { metadata: { pimMasterId: 'master-1', pimVersionId: 'version-1' } },
              },
            },
          ],
          shipping_address: {
            first_name: 'Recipient',
            phone: '',
            postal_code: '',
            address_1: '',
            address_2: '',
          },
        },
      ]),
    } as never);

    const inboxEvents: Array<{ payload: OrderCreatedPayload }> = [];
    const inboxService = {
      enqueue: jest.fn((event: { payload: OrderCreatedPayload }) => {
        inboxEvents.push(event);
        return Promise.resolve();
      }),
    };
    const syncStatusService = {
      getSyncStatus: jest.fn().mockResolvedValue(null),
      recordSyncStart: jest.fn().mockResolvedValue('sync-1'),
      recordSyncComplete: jest.fn().mockResolvedValue(undefined),
      recordSyncFailure: jest.fn().mockResolvedValue(undefined),
    };
    const pollingHashService = {
      computeHash: jest.fn((content: unknown) => JSON.stringify(content)),
      getStoredHash: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue(undefined),
    };
    const orderCollectionFailureService = {
      recordFailure: jest.fn(),
      findOpenByExternalOrderId: jest.fn().mockResolvedValue(null),
      closeAsTerminalLifecycle: jest.fn(),
    };
    const mappings = new Map<string, Record<string, unknown>>();
    const channelDb = {
      db: {
        select: () => ({
          from: () => ({
            where: () => ({ limit: () => Promise.resolve(Array.from(mappings.values()).slice(0, 1)) }),
          }),
        }),
        transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
          fn({
            insert: () => ({
              values: (value: Record<string, unknown>) => ({
                onConflictDoNothing: () => ({
                  returning: () => {
                    mappings.set(`${String(value.salesChannel)}:${String(value.channelOrderId)}`, value);
                    return Promise.resolve([value]);
                  },
                }),
              }),
            }),
          }),
      },
    };
    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatusService as never,
      inboxService as never,
      pollingHashService as never,
      orderCollectionFailureService as never,
      channelDb as never,
    );

    await orchestrator.poll();

    expect(inboxEvents).toHaveLength(1);
    const published = ORDER_STREAM.events.OrderCreated.schema!.parse(inboxEvents[0].payload);
    expect(published.items[0]).toMatchObject({
      orderItemId: rawOrderItemId,
      channelProductId: rawChannelProductId,
    });

    const salesOrderId = '22222222-2222-4222-8222-222222222222';
    const salesOrderLineId = '33333333-3333-4333-8333-333333333333';
    const storedLines: Array<Record<string, unknown>> = [];
    const coreTx = {
      insert: jest.fn((table: unknown) => ({
        values: (values: Record<string, unknown> | Array<Record<string, unknown>>) => {
          if (table === wmsTables.salesOrders) {
            return {
              returning: jest.fn().mockResolvedValue([
                {
                  id: salesOrderId,
                  ...(values as Record<string, unknown>),
                },
              ]),
            };
          }
          if (table === wmsTables.salesOrderLines) {
            const lines = Array.isArray(values) ? values : [values];
            storedLines.push(...lines.map((line) => ({ id: salesOrderLineId, ...line })));
          }
          return Promise.resolve();
        },
      })),
    };
    const coreDb = { run: jest.fn((fn: (tx: unknown) => unknown) => fn(coreTx)) };
    const policies = {
      getVariantPolicy: jest.fn().mockResolvedValue({
        inventoryManagement: false,
        preStockSellable: false,
        alwaysSellableZeroStock: false,
      }),
    };
    const salesOrders = new SalesOrdersService(
      coreDb as never,
      policies as never,
      { enqueue: jest.fn().mockResolvedValue(undefined) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await salesOrders.createFromEvent(published);

    expect(storedLines[0]).toMatchObject({
      channelOrderItemId: rawOrderItemId,
      channelProductId: rawChannelProductId,
    });

    const shipmentEvent = {
      shipmentId: '44444444-4444-4444-8444-444444444444',
      dispatchAttemptId: '55555555-5555-4555-8555-555555555555',
      attemptNo: 1,
      warehouseId: '66666666-6666-4666-8666-666666666666',
      dispatchedAt: '2026-07-14T02:00:00.000Z',
      invoice: {
        invoiceId: '77777777-7777-4777-8777-777777777777',
        carrier: 'CJ' as const,
        trackingNo: 'tracking-1',
      },
      orders: [
        {
          salesOrderId,
          fulfillmentOrderId: '88888888-8888-4888-8888-888888888888',
          salesChannel: 'medusa' as const,
          channelOrderId: published.externalOrderId!,
          isPartial: false,
          lines: [
            {
              shipmentLineId: '99999999-9999-4999-8999-999999999999',
              fulfillmentOrderItemId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              salesOrderLineId,
              channelOrderItemId: storedLines[0].channelOrderItemId,
              channelProductId: storedLines[0].channelProductId,
              skuId,
              qty: 1,
              isPartialQuantity: false,
            },
          ],
        },
      ],
    };
    const parsedShipment = SHIPMENT_STREAM.events.ShipmentShipped.schema!.parse(shipmentEvent);

    expect(parsedShipment.orders[0].lines[0]).toMatchObject({
      channelOrderItemId: rawOrderItemId,
      channelProductId: rawChannelProductId,
    });
    expect(parsedShipment.orders[0].lines[0].channelOrderItemId).toBe(published.items[0].orderItemId);
    expect(parsedShipment.orders[0].lines[0].channelProductId).toBe(published.items[0].channelProductId);
  });
});
