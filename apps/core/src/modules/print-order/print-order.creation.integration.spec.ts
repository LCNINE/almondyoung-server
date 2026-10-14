import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { DbService } from '@app/db';
import { wmsSchema, wmsTables, DbTx } from '../inventory/schema/inventory.schema';
import { makeDb, inRollbackTx } from '../fulfillment/services/__support__';
import { SalesOrdersService } from '../sales-order/services/sales-orders.service';
import { OrderEventsConsumer } from '../sales-order/consumers/order-events.consumer';
import type { PoliciesService } from '../sales-order/services/policies.service';
import type { ReservationLifecycleService } from '../inventory/shared/services/reservation-lifecycle.service';
import type { ProductSkuMappingService } from '../product-matching/services/product-sku-mapping.service';
import type { ProductSellableQuantityService } from '../inventory/product-sellable-quantity/services/product-sellable-quantity.service';
import type { LibraryService } from '../library/services/library.service';
import type { FulfillmentOrderCreationBacklogService } from '../fulfillment/backlog/fulfillment-order-creation-backlog.service';
import type { FulfillmentWorkflowGate } from '../fulfillment/services/fulfillment-workflow-gate.service';
import type { ChannelOrderChangeService } from '../sales-order/channel-order-change/channel-order-change.service';
import type { ChannelCancelSettler } from '../sales-order/channel-cancel-request/channel-cancel-settler';
import type { ChannelCancelRequestService } from '../sales-order/channel-cancel-request/channel-cancel-request.service';
import type { PrintOrderCancellationManager } from './services/print-order-cancellation.manager';
import { CORE_ORDER_STREAM, FULFILLMENT_STREAM } from '@packages/event-contracts/streams';
import type { PublisherFor } from '@app/events';
import { ORDER_STREAM, type OrderCreatedPayload } from '@packages/event-contracts/streams/orders.stream';
import type { EnvelopeOf } from '@packages/event-contracts/types';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

// 통합 스펙의 협력자 목: 이 경계에서만 형 변환을 쓴다 (실제로 쓰이는 메서드는 아래 필드뿐)
function makeDbServiceInTx(tx: DbTx): DbService<typeof wmsSchema> {
  return { db: tx, run: <T>(fn: (t: DbTx) => Promise<T>) => fn(tx) } as unknown as DbService<typeof wmsSchema>;
}

function makeConsumer(tx: DbTx): OrderEventsConsumer {
  const dbService = makeDbServiceInTx(tx);
  const outbox = { enqueue: () => Promise.resolve(undefined) };
  const policies = {
    getVariantPolicy: () =>
      Promise.resolve({
        inventoryManagement: false,
        preStockSellable: false,
        alwaysSellableZeroStock: false,
      }),
  };
  const unused = {};
  const service = new SalesOrdersService(
    dbService,
    policies as unknown as PoliciesService,
    outbox as unknown as PublisherFor<typeof FULFILLMENT_STREAM>,
    outbox as unknown as PublisherFor<typeof CORE_ORDER_STREAM>,
    unused as unknown as ReservationLifecycleService,
    unused as unknown as ProductSkuMappingService,
    unused as unknown as ProductSellableQuantityService,
    unused as unknown as FulfillmentOrderCreationBacklogService,
  );
  return new OrderEventsConsumer(
    service,
    unused as unknown as LibraryService,
    unused as unknown as FulfillmentOrderCreationBacklogService,
    unused as unknown as FulfillmentWorkflowGate,
    dbService,
    unused as unknown as ChannelOrderChangeService,
    unused as unknown as ChannelCancelSettler,
    unused as unknown as ChannelCancelRequestService,
    unused as unknown as PrintOrderCancellationManager,
  );
}

function envelope(): EnvelopeOf<typeof ORDER_STREAM, 'OrderCreated'> {
  // 핸들러가 읽는 건 messageId·correlationId 뿐이다
  return { messageId: randomUUID(), correlationId: randomUUID() } as unknown as EnvelopeOf<
    typeof ORDER_STREAM,
    'OrderCreated'
  >;
}

function item(over: Partial<OrderCreatedPayload['items'][number]> = {}) {
  const variantId = randomUUID();
  return {
    orderItemId: `item_${randomUUID().slice(0, 8)}`,
    channelProductId: 'prod',
    skuId: variantId,
    masterId: 'master',
    versionId: 'version',
    variantId,
    productName: '명함',
    quantity: 1,
    unitPrice: 1000,
    totalPrice: 1000,
    ...over,
  };
}

function payload(items: OrderCreatedPayload['items']): OrderCreatedPayload {
  return ORDER_STREAM.events.OrderCreated.schema!.parse({
    orderId: randomUUID(),
    externalOrderId: `order_${randomUUID().slice(0, 12)}`,
    salesChannel: 'medusa',
    customerId: null,
    items,
    totalAmount: 2000,
    subtotalAmount: 2000,
    shippingAmount: 0,
    discountAmount: 0,
    currency: 'KRW',
    shippingAddress: {
      recipientName: '수령인',
      phone: '01000000000',
      postalCode: '00000',
      roadAddress: '어딘가',
      detailAddress: '101호',
    },
    status: 'pending',
    createdAt: new Date().toISOString(),
  });
}

describeIfDb('OrderCreated → print_orders (DB integration, rollback-only)', () => {
  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql, db } = makeDb(DATABASE_URL!));
  });
  afterAll(async () => {
    await sql.end();
  });

  it('creates one pending print_order per almond line in the same tx', async () => {
    await inRollbackTx(db, async (tx) => {
      const designId = randomUUID();
      const p = payload([item({ almondDesignId: designId }), item()]);

      await makeConsumer(tx).handleOrderCreated(p, envelope());

      const [order] = await tx
        .select()
        .from(wmsTables.salesOrders)
        .where(eq(wmsTables.salesOrders.channelOrderId, p.externalOrderId ?? p.orderId));
      const lines = await tx
        .select()
        .from(wmsTables.salesOrderLines)
        .where(eq(wmsTables.salesOrderLines.salesOrderId, order.id));
      const almondLine = lines.find((l) => l.almondDesignId === designId);
      expect(almondLine).toBeDefined();

      const prints = await tx
        .select()
        .from(wmsTables.printOrders)
        .where(eq(wmsTables.printOrders.salesOrderId, order.id));
      expect(prints).toHaveLength(1);
      expect(prints[0]).toMatchObject({
        almondDesignId: designId,
        status: 'pending',
        vendor: 'wowpress',
        salesOrderLineId: almondLine!.id,
      });
    });
  });

  it('does not duplicate sales order or print_orders on redelivered OrderCreated', async () => {
    await inRollbackTx(db, async (tx) => {
      const p = payload([item({ almondDesignId: randomUUID() })]);
      const consumer = makeConsumer(tx);

      await consumer.handleOrderCreated(p, envelope());
      await consumer.handleOrderCreated(p, envelope());

      const channelOrderId = p.externalOrderId ?? p.orderId;
      const orders = await tx
        .select()
        .from(wmsTables.salesOrders)
        .where(eq(wmsTables.salesOrders.channelOrderId, channelOrderId));
      expect(orders).toHaveLength(1);

      const prints = await tx
        .select()
        .from(wmsTables.printOrders)
        .where(eq(wmsTables.printOrders.salesOrderId, orders[0].id));
      expect(prints).toHaveLength(1);
    });
  });
});
