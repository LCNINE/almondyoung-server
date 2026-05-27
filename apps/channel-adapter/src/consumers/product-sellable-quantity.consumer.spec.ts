import { ProductSellableQuantityConsumer } from './product-sellable-quantity.consumer';
import { inboxEvents, processedEvents } from '../schema';
import type { ProductSellableQuantityChangedPayload } from '@packages/event-contracts/streams/inventory.stream';

function createDbMock(existingProcessedEvents: unknown[] = []) {
  const inserts: Array<{ table: unknown; values: any }> = [];
  const limit = jest.fn().mockResolvedValue(existingProcessedEvents);
  const where = jest.fn(() => ({ limit }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));
  const insert = jest.fn((table: unknown) => ({
    values: jest.fn(async (values: any) => {
      inserts.push({ table, values });
    }),
  }));

  return {
    db: { select, insert },
    inserts,
  };
}

describe('ProductSellableQuantityConsumer', () => {
  const payload: ProductSellableQuantityChangedPayload = {
    variantId: 'pim-var-1',
    masterId: 'master-1',
    versionId: 'version-1',
    matchingId: 'matching-1',
    sellableQuantity: 7,
    stockBoundQuantity: 7,
    isSellable: true,
    reason: 'SELLABLE',
    calculatedAt: '2026-05-27T00:00:00.000Z',
  };

  const envelope = {
    messageId: 'msg-1',
    correlationId: 'corr-1',
    chainId: 'chain-1',
  } as any;

  it('stores ProductSellableQuantityChanged in the inbox for asynchronous Medusa sync', async () => {
    const dbMock = createDbMock();
    const consumer = new ProductSellableQuantityConsumer({ db: dbMock.db } as any);

    await consumer.onProductSellableQuantityChanged(envelope, payload);

    expect(dbMock.inserts).toHaveLength(2);
    expect(dbMock.inserts[0].table).toBe(processedEvents);
    expect(dbMock.inserts[0].values).toMatchObject({
      idempotencyKey: 'pim-var-1:2026-05-27T00:00:00.000Z:ProductSellableQuantityChanged',
      source: 'inventory.events.v1',
      eventType: 'ProductSellableQuantityChanged',
      resourceId: 'pim-var-1',
      eventVersion: 'msg-1',
      status: 'PROCESSED',
    });

    expect(dbMock.inserts[1].table).toBe(inboxEvents);
    expect(dbMock.inserts[1].values).toMatchObject({
      eventType: 'ProductSellableQuantityChanged',
      aggregateType: 'ProductVariant',
      aggregateId: 'pim-var-1',
      partitionKey: 'pim-var-1',
      payload,
      metadata: {
        correlationId: 'corr-1',
        messageId: 'msg-1',
        chainId: 'chain-1',
      },
      status: 'pending',
    });
  });

  it('skips duplicate replay when the idempotency key has already been processed', async () => {
    const dbMock = createDbMock([{ idempotencyKey: 'pim-var-1:2026-05-27T00:00:00.000Z' }]);
    const consumer = new ProductSellableQuantityConsumer({ db: dbMock.db } as any);

    await consumer.onProductSellableQuantityChanged(envelope, payload);

    expect(dbMock.db.insert).not.toHaveBeenCalled();
    expect(dbMock.inserts).toHaveLength(0);
  });
});
