import { ORDER_STREAM, type OrderCreatedPayload } from '@packages/event-contracts/streams';
import type { StreamPublisher } from '@app/events';
import type { ChannelListingClient } from './clients/channel-listing.client';
import { OrderEventPublisher } from './order-event.publisher.legacy';

const LISTING = {
  masterId: 'master-legacy',
  versionId: 'version-legacy',
  productName: 'Mapped legacy product',
  variantId: 'variant-legacy',
  variantCode: null,
  variantName: null,
  isActive: true,
};

describe('legacy OrderEventPublisher external line identity', () => {
  it('keeps independently supplied IDs and omits an unavailable product ID', async () => {
    const ordersPublisher = {
      publishEvent: jest.fn<Promise<void>, [{ payload: OrderCreatedPayload }]>().mockResolvedValue(undefined),
    };
    const channelListingClient = {
      getChannelCodeFromType: jest.fn().mockReturnValue('naver'),
      lookupByChannelCode: jest.fn().mockResolvedValue(LISTING),
    };
    const publisher = new OrderEventPublisher(
      ordersPublisher as unknown as StreamPublisher<typeof ORDER_STREAM.events>,
      channelListingClient as unknown as ChannelListingClient,
    );

    await publisher.publishOrderCreated(
      'naver_smartstore',
      {
        channelType: 'naver_smartstore',
        externalOrderId: 'channel-order-legacy',
        externalProductOrderId: 'naver-product-order-legacy',
        status: 'PAID',
        quantity: 1,
        priceAmount: 1000,
        createdAt: '2026-07-14T01:00:00.000Z',
      },
      jest.fn().mockResolvedValue(LISTING),
    );

    const payload = ordersPublisher.publishEvent.mock.calls[0][0].payload;
    expect(ORDER_STREAM.events.OrderCreated.schema!.parse(payload)).toEqual(payload);
    expect(payload.items[0]).toMatchObject({ orderItemId: 'naver-product-order-legacy' });
    expect(payload.items[0]).not.toHaveProperty('channelProductId');
    expect(payload.items[0].orderItemId).not.toBe(payload.externalOrderId);
  });

  it('preserves distinct Coupang order-item and vendor-item IDs', async () => {
    const ordersPublisher = {
      publishEvent: jest.fn<Promise<void>, [{ payload: OrderCreatedPayload }]>().mockResolvedValue(undefined),
    };
    const channelListingClient = {
      getChannelCodeFromType: jest.fn().mockReturnValue('coupang'),
      lookupByChannelCode: jest.fn().mockResolvedValue(LISTING),
    };
    const publisher = new OrderEventPublisher(
      ordersPublisher as unknown as StreamPublisher<typeof ORDER_STREAM.events>,
      channelListingClient as unknown as ChannelListingClient,
    );

    await publisher.publishOrderConfirmed('coupang', {
      channelType: 'coupang',
      externalOrderId: 'coupang-order-1',
      externalProductOrderId: 'coupang-order-item-1',
      productId: 'coupang-vendor-item-1',
      status: 'PAID',
      quantity: 1,
      priceAmount: 1000,
      createdAt: '2026-07-14T01:00:00.000Z',
    });

    expect(channelListingClient.lookupByChannelCode).toHaveBeenCalledWith('coupang', 'coupang-vendor-item-1');
    const item = ordersPublisher.publishEvent.mock.calls[0][0].payload.items[0];
    expect(item).toMatchObject({
      orderItemId: 'coupang-order-item-1',
      channelProductId: 'coupang-vendor-item-1',
    });
  });
});
