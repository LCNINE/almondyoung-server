import { ORDER_STREAM, type OrderCancelledPayload, type OrderCreatedPayload } from '@packages/event-contracts/streams';
import type { InternalOrderEvent } from '../types';
import type { InboxService } from './inbox.service';
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
    const inboxService = {
      enqueue: jest.fn<Promise<void>, [{ payload: OrderCreatedPayload }, unknown?]>().mockResolvedValue(undefined),
    };
    const channelListingClient = {
      getChannelCodeFromType: jest.fn((channel: string) => (channel === 'naver_smartstore' ? 'naver' : channel)),
      lookupByChannelCode: jest.fn().mockResolvedValue(LISTING),
    };
    return {
      publisher: new OrderEventPublisher(
        inboxService as unknown as InboxService,
        channelListingClient as unknown as ChannelListingClient,
      ),
      inboxService,
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
    const { publisher, inboxService, channelListingClient } = makePublisher();

    await publisher.publishOrderConfirmed(
      fixture.channel,
      orderEvent({
        channelType: fixture.channel,
        externalProductOrderId: fixture.orderItemId,
        productId: fixture.productId,
      }),
    );

    expect(channelListingClient.lookupByChannelCode).toHaveBeenCalledWith(fixture.salesChannel, fixture.productId);
    const payload = inboxService.enqueue.mock.calls[0][0].payload;
    expect(ORDER_STREAM.events.OrderCreated.schema!.parse(payload)).toEqual(payload);
    expect(payload.items[0]).toMatchObject({
      orderItemId: fixture.orderItemId,
      channelProductId: fixture.productId,
    });
  });

  it('does not manufacture channelProductId from an old order-line-only event', async () => {
    const { publisher, inboxService, channelListingClient } = makePublisher();

    await publisher.publishOrderConfirmed(
      'naver_smartstore',
      orderEvent({ productId: undefined, externalProductOrderId: 'legacy-product-order-1' }),
    );

    expect(channelListingClient.lookupByChannelCode).toHaveBeenCalledWith('naver', 'legacy-product-order-1');
    const item = inboxService.enqueue.mock.calls[0][0].payload.items[0];
    expect(item).toMatchObject({ orderItemId: 'legacy-product-order-1' });
    expect(item).not.toHaveProperty('channelProductId');
  });

  it('does not use channelOrderId as either missing line identity', async () => {
    const { publisher, inboxService, channelListingClient } = makePublisher();

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
    expect(inboxService.enqueue).not.toHaveBeenCalled();
  });

  it('publishes cancellation with the channel identity needed to resolve the Core order', async () => {
    const { publisher, inboxService } = makePublisher();

    await publisher.publishOrderCancelled(
      'naver_smartstore',
      orderEvent({
        internalOrderId: 'channel-adapter-generated-id',
        externalOrderId: 'naver-order-1',
      }),
    );

    const payload = inboxService.enqueue.mock.calls[0][0].payload as unknown as OrderCancelledPayload;
    expect(ORDER_STREAM.events.OrderCancelled.schema!.parse(payload)).toEqual(payload);
    expect(payload).toMatchObject({
      orderId: 'channel-adapter-generated-id',
      externalOrderId: 'naver-order-1',
      salesChannel: 'naver',
    });
  });
});
