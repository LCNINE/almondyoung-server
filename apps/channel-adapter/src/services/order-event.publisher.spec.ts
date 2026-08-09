import type { DbService } from '@app/db';
import type { PublisherFor } from '@app/events';
import { ORDER_STREAM, type OrderCreatedPayload } from '@packages/event-contracts/streams';
import type { InternalOrderEvent, channelAdapterSchema } from '../types';
import type { ChannelListingClient } from './clients/channel-listing.client';
import { OrderEventPublisher } from './order-event.publisher';

const LISTING = {
  masterId: 'master-1',
  versionId: 'version-1',
  productName: 'Mapped product',
  variantId: 'variant-1',
  variantCode: null,
  variantName: null,
  isActive: true,
};

function orderEvent(overrides: Partial<InternalOrderEvent> = {}): InternalOrderEvent {
  return {
    channelType: 'naver_smartstore',
    externalOrderId: 'channel-order-1',
    externalProductOrderId: 'provider-order-item-1',
    productId: 'provider-product-1',
    status: 'PAID',
    quantity: 1,
    priceAmount: 1000,
    createdAt: '2026-07-14T01:00:00.000Z',
    ...overrides,
  };
}

describe('OrderEventPublisher external line identity', () => {
  function makePublisher() {
    // 적재는 이제 공용 아웃박스(`StreamPublisher.enqueue`)로 간다 (Task 6-C-3).
    // 두 번째 인자는 적재 대상(트랜잭션 또는 커넥션)이므로 그것까지 관찰한다 —
    // 여기서는 `DbService.db` 가 넘어와야 한다(호출자가 tx 를 주지 않았다).
    const outbox = {
      enqueue: jest
        .fn<Promise<void>, [{ payload: OrderCreatedPayload; partitionKey?: string }, unknown]>()
        .mockResolvedValue(undefined),
    };
    const db = { db: { insert: jest.fn() } };
    const channelListingClient = {
      getChannelCodeFromType: jest.fn((channel: string) => (channel === 'naver_smartstore' ? 'naver' : channel)),
      lookupByChannelCode: jest.fn().mockResolvedValue(LISTING),
    };
    return {
      publisher: new OrderEventPublisher(
        db as unknown as DbService<typeof channelAdapterSchema>,
        channelListingClient as unknown as ChannelListingClient,
        outbox as unknown as PublisherFor<typeof ORDER_STREAM>,
      ),
      outbox,
      db,
      channelListingClient,
    };
  }

  it.each([
    {
      channel: 'naver_smartstore' as const,
      salesChannel: 'naver',
      orderItemId: 'naver-product-order-100',
      productId: 'naver-product-900',
    },
    {
      channel: 'coupang' as const,
      salesChannel: 'coupang',
      orderItemId: 'coupang-order-item-200',
      productId: 'coupang-vendor-item-800',
    },
  ])('publishes independent $salesChannel order-item/product IDs', async (fixture) => {
    const { publisher, outbox, db, channelListingClient } = makePublisher();

    await publisher.publishOrderConfirmed(
      fixture.channel,
      orderEvent({
        channelType: fixture.channel,
        externalProductOrderId: fixture.orderItemId,
        productId: fixture.productId,
      }),
    );

    expect(channelListingClient.lookupByChannelCode).toHaveBeenCalledWith(fixture.salesChannel, fixture.productId);
    const [params, writer] = outbox.enqueue.mock.calls[0];
    expect(ORDER_STREAM.events.OrderCreated.schema!.parse(params.payload)).toEqual(params.payload);
    expect(params.payload.items[0]).toMatchObject({
      orderItemId: fixture.orderItemId,
      channelProductId: fixture.productId,
    });
    // 파티션 키는 **채널명**이어야 한다. 생략하면 ORDER_STREAM 에 파생 함수가 없어
    // aggregateId(= externalOrderId) 로 떨어지고, 채널 단위 순서가 조용히 사라진다.
    expect(params.partitionKey).toBe(fixture.channel);
    // 호출자가 트랜잭션을 주지 않았으므로 커넥션에 직접 쓴다.
    expect(writer).toBe(db.db);
  });

  it('does not manufacture channelProductId from an old order-line-only event', async () => {
    const { publisher, outbox, channelListingClient } = makePublisher();

    await publisher.publishOrderConfirmed(
      'naver_smartstore',
      orderEvent({ productId: undefined, externalProductOrderId: 'legacy-product-order-1' }),
    );

    expect(channelListingClient.lookupByChannelCode).toHaveBeenCalledWith('naver', 'legacy-product-order-1');
    const item = outbox.enqueue.mock.calls[0][0].payload.items[0];
    expect(item).toMatchObject({ orderItemId: 'legacy-product-order-1' });
    expect(item).not.toHaveProperty('channelProductId');
  });

  it('does not use channelOrderId as either missing line identity', async () => {
    const { publisher, outbox, channelListingClient } = makePublisher();

    await expect(
      publisher.publishOrderConfirmed(
        'coupang',
        orderEvent({
          externalOrderId: 'must-not-be-a-line-id',
          externalProductOrderId: undefined,
          productId: undefined,
        }),
      ),
    ).resolves.toEqual({
      published: false,
      pendingReason: 'missing_external_product_identity',
      unmappedItems: [],
    });
    expect(channelListingClient.lookupByChannelCode).not.toHaveBeenCalled();
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });
});
