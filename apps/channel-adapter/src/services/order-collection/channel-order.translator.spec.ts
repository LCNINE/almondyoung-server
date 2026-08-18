import { ORDER_STREAM, ShippingAddress } from '@packages/event-contracts/streams';
import { ChannelLineIdentityResolver } from './channel-line-identity.resolver';
import { ChannelOrderTranslator } from './channel-order.translator';
import { CHANNEL_PRODUCT_IDENTIFICATION_FAILED } from './channel-order-provider.interface';
import type { ChannelOrderSnapshot, ChannelPaymentState } from './channel-order-source.interface';

const SHIPPING_ADDRESS: ShippingAddress = {
  recipientName: '김구매',
  phone: '010-0000-0000',
  postalCode: '12345',
  roadAddress: '서울시 어딘가',
  detailAddress: '101동 101호',
};

function makeSnapshot(overrides: Partial<ChannelOrderSnapshot> = {}): ChannelOrderSnapshot {
  return {
    externalOrderId: 'naver-order-1',
    sourceUpdatedAt: '2026-08-16T01:00:00.000Z',
    paymentState: 'accepted' as ChannelPaymentState,
    customerId: null,
    lines: [
      {
        channelOrderItemId: 'naver-product-order-1',
        channelProductId: 'naver-product-1',
        productName: '채널이 부르는 이름',
        quantity: 2,
        unitPrice: 5000,
      },
    ],
    amounts: { total: 10000, subtotal: 10000, shipping: 0, discount: 0, currency: 'KRW' },
    shippingAddress: SHIPPING_ADDRESS,
    createdAt: '2026-08-16T00:59:00.000Z',
    lifecycle: [],
    raw: { source: 'naver' },
    ...overrides,
  };
}

function makeTranslator(listing: unknown) {
  const resolveByChannelCode = jest
    .fn()
    .mockResolvedValue(listing ? { found: true, listing } : { found: false, cause: 'listing_not_found' });
  const translator = new ChannelOrderTranslator(
    new ChannelLineIdentityResolver({ resolveByChannelCode } as never),
  );
  return { translator, resolveByChannelCode };
}

const LISTING = {
  masterId: '22222222-2222-4222-8222-222222222222',
  versionId: '33333333-3333-4333-8333-333333333333',
  variantId: '11111111-1111-4111-8111-111111111111',
  variantCode: 'AY-1',
  variantName: '옵션 A',
  productName: 'Core 판매상품명',
  isActive: true,
};

describe('ChannelOrderTranslator — lineIdentity: mapped (naver/coupang)', () => {
  it('채널 리스팅으로 라인 정체성을 해석하고 Core 판매상품명을 싣는다', async () => {
    const { translator, resolveByChannelCode } = makeTranslator(LISTING);

    const { outcome } = await translator.translate('naver', makeSnapshot());

    expect(resolveByChannelCode).toHaveBeenCalledWith('naver', 'naver-product-1');
    expect(outcome.kind).toBe('order');
    if (outcome.kind !== 'order') throw new Error('unreachable');

    const payload = outcome.order.createPayload;
    expect(payload.salesChannel).toBe('naver');
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).toMatchObject({
      orderItemId: 'naver-product-order-1',
      channelProductId: 'naver-product-1',
      variantId: LISTING.variantId,
      skuId: LISTING.variantId,
      masterId: LISTING.masterId,
      versionId: LISTING.versionId,
      quantity: 2,
      unitPrice: 5000,
      totalPrice: 10000,
    });
    // ADR-0031 결정 3: 이름은 Core 값, 금액은 채널 값.
    expect(payload.items[0].productName).toBe('Core 판매상품명');
    expect(payload.totalAmount).toBe(10000);
    expect(ORDER_STREAM.events.OrderCreated.schema!.parse(payload)).toEqual(payload);
  });

  it('매핑이 없는 유료 주문은 조용히 넘기지 않고 채널 상품 식별 실패로 격리한다', async () => {
    const { translator } = makeTranslator(null);

    const { outcome } = await translator.translate('naver', makeSnapshot());

    expect(outcome.kind).toBe('failure');
    if (outcome.kind !== 'failure') throw new Error('unreachable');
    expect(outcome.failure).toMatchObject({
      externalOrderId: 'naver-order-1',
      reason: CHANNEL_PRODUCT_IDENTIFICATION_FAILED,
      affectedLineIds: ['naver-product-order-1'],
      rawOrder: { source: 'naver' },
    });
  });

  it('이미 종결된 스냅샷은 매핑이 없어도 격리하지 않는다 — 판매주문을 만들지 않기 때문', async () => {
    const { translator } = makeTranslator(null);

    const { outcome } = await translator.translate(
      'naver',
      makeSnapshot({
        paymentState: 'terminal',
        lifecycle: [
          {
            eventType: 'OrderCancelled',
            eventKey: 'cancelled',
            payload: {
              reason: 'ADMIN_CANCEL',
              cancelledBy: 'naver',
              cancelledAt: '2026-08-16T01:00:00.000Z',
              refundRequired: false,
            },
            rawEvent: {},
          },
        ],
      }),
    );

    expect(outcome.kind).toBe('order');
    if (outcome.kind !== 'order') throw new Error('unreachable');
    expect(outcome.order.eligibleForOrderCreation).toBe(false);
    expect(outcome.order.createPayload.items[0].variantId).toBe('');
  });

  it('라이프사이클 관측에 주문 좌표를 붙여 넘긴다 (orderId 는 수집 module 이 채운다)', async () => {
    const { translator } = makeTranslator(LISTING);

    const { lifecycle } = await translator.translate(
      'naver',
      makeSnapshot({
        lifecycle: [
          {
            eventType: 'OrderRefundCreated',
            eventKey: 'refund:r-1',
            payload: {
              refundId: 'r-1',
              paymentId: 'p-1',
              amount: 1000,
              currency: 'KRW',
              reason: 'CHANNEL_REFUND',
              createdBy: 'naver',
              createdAt: '2026-08-16T01:00:00.000Z',
            },
            rawEvent: { refundId: 'r-1' },
          },
        ],
      }),
    );

    expect(lifecycle).toHaveLength(1);
    expect(lifecycle[0]).toMatchObject({
      externalOrderId: 'naver-order-1',
      sourceUpdatedAt: '2026-08-16T01:00:00.000Z',
      eventType: 'OrderRefundCreated',
      eventKey: 'refund:r-1',
    });
    expect(lifecycle[0].payload).not.toHaveProperty('orderId');
  });
});

describe('ChannelOrderTranslator — 변경 해시 입력의 모양', () => {
  /**
   * `OrderFetchItem.changes` 는 저장된 `polling_change_hashes` 의 입력이다. 여기에 채널 원어를
   * 넣으면 배포 직후 한 폴링 주기의 주문이 전부 `collected_order_modification_not_accepted` 로
   * 격리되고, 그 사유는 replay 가 거부한다 — 운영자가 화면에서 지울 수 없는 행이 남는다.
   *
   * 그래서 이 스펙은 "번역 결과 세 값" 이라는 계약을 못 박는다.
   */
  it('changes 는 채널 원어가 아니라 번역된 Core 계약 값 세 개만 담는다', async () => {
    const { translator } = makeTranslator(LISTING);

    const { outcome } = await translator.translate('naver', makeSnapshot());
    if (outcome.kind !== 'order') throw new Error('unreachable');

    expect(Object.keys(outcome.order.changes).sort()).toEqual(['items', 'shippingAddress', 'totalAmount']);
    expect(outcome.order.changes.items).toEqual(outcome.order.createPayload.items);
    expect(outcome.order.changes.shippingAddress).toEqual(SHIPPING_ADDRESS);
    expect(outcome.order.changes.totalAmount).toBe(10000);
  });
});
