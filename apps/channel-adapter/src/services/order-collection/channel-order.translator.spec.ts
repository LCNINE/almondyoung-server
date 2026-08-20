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
    // resolver 가 준 사유(#674)가 라인 ID 와 정확히 짝지어 실려야 한다 — 순서가 바뀌거나
    // 필드가 뒤바뀌면(lineId↔cause) 여기서 잡힌다.
    expect(outcome.failure.affectedLines).toEqual([
      { lineId: 'naver-product-order-1', cause: 'listing_not_found', channelProductId: 'naver-product-1' },
    ]);
  });

  it('격리 행에 해석에 쓴 채널상품ID 를 함께 남긴다 — 화면 프리필의 정본이다', async () => {
    const { translator } = makeTranslator(null);

    const { outcome } = await translator.translate(
      'naver',
      makeSnapshot({
        lines: [
          {
            channelOrderItemId: 'po-1',
            channelProductId: '13700000002',
            productName: '미매핑 상품',
            quantity: 1,
            unitPrice: 5000,
          },
        ],
      }),
    );

    expect(outcome.kind).toBe('failure');
    if (outcome.kind !== 'failure') return;
    expect(outcome.failure.affectedLines).toEqual([
      { lineId: 'po-1', cause: 'listing_not_found', channelProductId: '13700000002' },
    ]);
  });

  it('여러 라인 중 일부만 미식별이면 그 라인의 사유만, Core 가 준 값 그대로 싣는다', async () => {
    // 기본값(listing_not_found)만으로는 "항상 같은 값을 하드코딩" 하는 버그를 못 잡으므로
    // resolveByChannelCode 가 라인별로 다른 결과를 주도록 직접 구성한다 (#674 리뷰 지적).
    const resolveByChannelCode = jest.fn((_channel: string, lookupId: string) => {
      if (lookupId === 'naver-product-1') {
        return Promise.resolve({ found: true, listing: LISTING });
      }
      return Promise.resolve({ found: false, cause: 'variant_inactive' });
    });
    const translator = new ChannelOrderTranslator(
      new ChannelLineIdentityResolver({ resolveByChannelCode } as never),
    );

    const { outcome } = await translator.translate(
      'naver',
      makeSnapshot({
        lines: [
          {
            channelOrderItemId: 'naver-product-order-1',
            channelProductId: 'naver-product-1',
            productName: '식별되는 상품',
            quantity: 2,
            unitPrice: 5000,
          },
          {
            channelOrderItemId: 'naver-product-order-2',
            channelProductId: 'naver-product-2',
            productName: '비활성 옵션',
            quantity: 1,
            unitPrice: 3000,
          },
        ],
      }),
    );

    expect(outcome.kind).toBe('failure');
    if (outcome.kind !== 'failure') throw new Error('unreachable');
    // 식별된 첫 라인은 빠지고, 미식별인 두 번째 라인만 — Core 가 준 cause 그대로 — 남아야 한다.
    expect(outcome.failure.affectedLineIds).toEqual(['naver-product-order-2']);
    expect(outcome.failure.affectedLines).toEqual([
      { lineId: 'naver-product-order-2', cause: 'variant_inactive', channelProductId: 'naver-product-2' },
    ]);
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

describe('ChannelOrderTranslator — 취소된 라인', () => {
  /**
   * 네이버는 한 주문의 일부 상품주문만 취소되는 일이 흔하다. 취소된 라인을 스냅샷에서 빼버리면
   * 변경 해시(`changes.items`)가 달라져 부분취소가 `collected_order_modification_not_accepted`
   * 로 오격리된다 — 그 사유는 replay 가 거부한다. 그래서 취소 라인은 계약(`createPayload.items`)
   * 에서만 빠지고 해시 입력(`changes.items`)에는 남아야 한다.
   */
  it('취소된 라인은 판매주문 계약에서 빠지지만 변경 해시에는 남는다', async () => {
    const { translator } = makeTranslator(LISTING);

    const { outcome } = await translator.translate(
      'naver',
      makeSnapshot({
        lines: [
          {
            channelOrderItemId: 'po-1',
            channelProductId: 'naver-product-1',
            productName: '살아있는 라인',
            quantity: 1,
            unitPrice: 5000,
          },
          {
            channelOrderItemId: 'po-2',
            channelProductId: 'naver-product-2',
            productName: '취소된 라인',
            quantity: 1,
            unitPrice: 3000,
            cancelled: true,
          },
        ],
      }),
    );

    expect(outcome.kind).toBe('order');
    if (outcome.kind !== 'order') return;
    expect(outcome.order.createPayload.items.map((i) => i.orderItemId)).toEqual(['po-1']);
    expect(outcome.order.changes.items.map((i) => i.orderItemId)).toEqual(['po-1', 'po-2']);
  });

  it('취소된 라인의 미식별은 격리를 부르지 않는다', async () => {
    const { translator, resolveByChannelCode } = makeTranslator(LISTING);
    resolveByChannelCode.mockImplementation(async (_channelCode: string, channelItemId: string) =>
      channelItemId === 'naver-product-2'
        ? { found: false, cause: 'listing_not_found' }
        : { found: true, listing: LISTING },
    );

    const { outcome } = await translator.translate(
      'naver',
      makeSnapshot({
        lines: [
          {
            channelOrderItemId: 'po-1',
            channelProductId: 'naver-product-1',
            productName: '살아있는 라인',
            quantity: 1,
            unitPrice: 5000,
          },
          {
            channelOrderItemId: 'po-2',
            channelProductId: 'naver-product-2',
            productName: '취소된 라인',
            quantity: 1,
            unitPrice: 3000,
            cancelled: true,
          },
        ],
      }),
    );

    expect(outcome.kind).toBe('order');
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

  /**
   * `allLinesTotal` 을 내지 않는 source 가 Medusa 다. 폴백이 사라지면 Medusa 의 해시 입력이
   * 바뀌어 배포 직후 한 주기의 주문이 전부 `collected_order_modification_not_accepted` 로
   * 격리된다 — replay 가 거부하는 사유라 운영자가 지울 수 없는 행이 남는다.
   */
  it('allLinesTotal 이 없으면 총액은 amounts.total 그대로다 (Medusa 해시 입력 불변)', async () => {
    const { translator } = makeTranslator(LISTING);

    // `MedusaOrderSource` 의 amounts 가 정확히 이 모양이다 — `allLinesTotal` 을 세팅하지 않는다.
    const snapshot = makeSnapshot();
    expect(snapshot.amounts.allLinesTotal).toBeUndefined();

    const { outcome } = await translator.translate('naver', snapshot);
    if (outcome.kind !== 'order') throw new Error('unreachable');

    expect(outcome.order.changes.totalAmount).toBe(snapshot.amounts.total);
    expect(outcome.order.changes.totalAmount).toBe(outcome.order.createPayload.totalAmount);
  });

  /**
   * 부분취소가 `changes` 해시를 흔들면 그 주문은 다음 폴링에서 오격리된다. `items` 는 이미 전
   * 라인을 담고 있었지만 총액은 계약 총액(살아있는 라인 합)을 재사용하고 있어 취소가 곧 값
   * 변경이었다 — 해시 전용 총액을 따로 받아 그 축을 끊는다.
   */
  it('allLinesTotal 이 있으면 해시 총액으로 그것을 쓴다 — 계약 총액과 갈린다 (FIX C)', async () => {
    const { translator } = makeTranslator(LISTING);

    const { outcome } = await translator.translate(
      'naver',
      makeSnapshot({
        lines: [
          {
            channelOrderItemId: 'po-1',
            channelProductId: 'naver-product-1',
            productName: '살아있는 라인',
            quantity: 1,
            unitPrice: 5000,
          },
          {
            channelOrderItemId: 'po-2',
            channelProductId: 'naver-product-1',
            productName: '취소된 라인',
            quantity: 1,
            unitPrice: 3000,
            cancelled: true,
          },
        ],
        amounts: {
          total: 5000,
          subtotal: 5000,
          shipping: 0,
          discount: 0,
          currency: 'KRW',
          allLinesTotal: 8000,
        },
      }),
    );
    if (outcome.kind !== 'order') throw new Error('unreachable');

    // 계약 총액은 실판매분(5000), 해시 총액은 전 라인(8000) — 취소 전과 같은 값이다.
    expect(outcome.order.createPayload.totalAmount).toBe(5000);
    expect(outcome.order.changes.totalAmount).toBe(8000);
  });
});

describe('ChannelOrderTranslator — 공동현관 비밀번호', () => {
  it('스냅샷의 entrancePassword 를 createPayload 로 옮긴다', async () => {
    const { translator } = makeTranslator(LISTING);

    const { outcome } = await translator.translate('naver', makeSnapshot({ entrancePassword: '#1234' }));
    if (outcome.kind !== 'order') throw new Error('unreachable');

    expect(outcome.order.createPayload.entrancePassword).toBe('#1234');
  });

  it('스냅샷에 entrancePassword 가 없으면 payload 에 그 키 자체가 없다', async () => {
    const { translator } = makeTranslator(LISTING);

    const { outcome } = await translator.translate('naver', makeSnapshot());
    if (outcome.kind !== 'order') throw new Error('unreachable');

    expect('entrancePassword' in outcome.order.createPayload).toBe(false);
  });

  /**
   * `changes` 는 `polling_change_hashes` 의 입력이다. 비번은 모디피케이션 감지 입력이 아니므로
   * 해시 모양에 섞이면 안 된다 — 섞이면 배포 직후 비번 유무가 바뀔 때마다 오격리 위험이 생긴다.
   */
  it('entrancePassword 는 changes 해시 입력에는 실리지 않는다', async () => {
    const { translator } = makeTranslator(LISTING);

    const { outcome } = await translator.translate('naver', makeSnapshot({ entrancePassword: '#1234' }));
    if (outcome.kind !== 'order') throw new Error('unreachable');

    expect('entrancePassword' in outcome.order.changes).toBe(false);
  });
});
