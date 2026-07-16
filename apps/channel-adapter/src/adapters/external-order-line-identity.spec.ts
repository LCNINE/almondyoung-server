import { CoupangAdapter } from './coupang/coupang.adapter';
import { NaverSmartstoreAdapter } from './naver/naver-smartstore.adapter';
import type { InternalOrderEvent } from '../types';

type NaverIdentityTransform = {
  transformProductInfosToInternalEvents(productInfos: unknown[]): InternalOrderEvent[];
};

type CoupangIdentityTransform = {
  transformCoupangOrderSheetsToInternal(orderSheets: unknown[], dataType: 'orders'): InternalOrderEvent[];
  transformSingleCoupangOrderSheetToInternal(orderSheet: unknown): InternalOrderEvent;
};

function naverAdapter(): NaverSmartstoreAdapter {
  return new NaverSmartstoreAdapter(
    {} as unknown as ConstructorParameters<typeof NaverSmartstoreAdapter>[0],
    {} as unknown as ConstructorParameters<typeof NaverSmartstoreAdapter>[1],
    {} as unknown as ConstructorParameters<typeof NaverSmartstoreAdapter>[2],
    {} as unknown as ConstructorParameters<typeof NaverSmartstoreAdapter>[3],
    {} as unknown as ConstructorParameters<typeof NaverSmartstoreAdapter>[4],
  );
}

function coupangAdapter(): CoupangAdapter {
  return new CoupangAdapter(
    {} as unknown as ConstructorParameters<typeof CoupangAdapter>[0],
    {} as unknown as ConstructorParameters<typeof CoupangAdapter>[1],
    {} as unknown as ConstructorParameters<typeof CoupangAdapter>[2],
    {} as unknown as ConstructorParameters<typeof CoupangAdapter>[3],
    {} as unknown as ConstructorParameters<typeof CoupangAdapter>[4],
  );
}

describe('channel adapter external order-line identity transforms', () => {
  it('keeps Naver productOrderId separate from its productId', () => {
    const adapter = naverAdapter() as unknown as NaverIdentityTransform;

    const [event] = adapter.transformProductInfosToInternalEvents([
      {
        order: { orderId: 'naver-order-1', paymentDate: '2026-07-14T01:00:00.000Z' },
        productOrder: {
          productOrderId: 'naver-product-order-1',
          productId: 'naver-product-1',
          productOrderStatus: 'PAYED',
          quantity: 1,
          totalProductAmount: 1000,
        },
      },
    ]);

    expect(event).toMatchObject({
      externalOrderId: 'naver-order-1',
      externalProductOrderId: 'naver-product-order-1',
      productId: 'naver-product-1',
    });
  });

  it('keeps Coupang orderItemId separate from its vendorItemId', () => {
    const adapter = coupangAdapter() as unknown as CoupangIdentityTransform;
    const [event] = adapter.transformCoupangOrderSheetsToInternal(
      [
        {
          orderId: 100,
          status: 'ACCEPT',
          orderedAt: '2026-07-14T01:00:00.000Z',
          paidAt: '2026-07-14T01:01:00.000Z',
          receiver: {
            name: 'Recipient',
            safeNumber: '010-0000-0000',
            postCode: '12345',
            addr1: 'Seoul',
            addr2: '101',
          },
          orderItems: [
            {
              orderItemId: 200,
              vendorItemId: 800,
              shippingCount: 1,
              salesPrice: { units: 1000 },
              discountPrice: { units: 0 },
            },
          ],
        },
      ],
      'orders',
    );

    expect(event).toMatchObject({
      externalOrderId: '100',
      externalProductOrderId: '200',
      productId: '800',
    });
  });

  it('does not substitute Coupang vendorItemId when orderItemId is unavailable', () => {
    const adapter = coupangAdapter() as unknown as CoupangIdentityTransform;
    const event = adapter.transformSingleCoupangOrderSheetToInternal({
      orderId: 100,
      status: 'ACCEPT',
      orderedAt: '2026-07-14T01:00:00.000Z',
      paidAt: '2026-07-14T01:01:00.000Z',
      receiver: {
        name: 'Recipient',
        safeNumber: '010-0000-0000',
        postCode: '12345',
        addr1: 'Seoul',
        addr2: '101',
      },
      orderItems: [
        {
          vendorItemId: 800,
          shippingCount: 1,
          salesPrice: { units: 1000 },
          discountPrice: { units: 0 },
        },
      ],
    });

    expect(event.externalProductOrderId).toBeUndefined();
    expect(event.productId).toBe('800');
  });
});
