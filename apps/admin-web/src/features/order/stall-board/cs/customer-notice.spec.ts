import type {
  ProgressItem,
  ReserveShortageView,
} from '@/lib/api/domains/orders/order-progress.shape';
import { customerNotice } from './customer-notice';

const shortage = (
  patch: Partial<ReserveShortageView> = {}
): ReserveShortageView => ({
  shipmentId: 'b',
  manifestVersion: 1,
  consolidated: false,
  splittable: true,
  skuKinds: 2,
  shortSkuKinds: 2,
  items: [
    {
      skuId: '1',
      skuName: '고무볼',
      shortQty: 8,
      expectedArrival: '2026-11-28',
    },
    {
      skuId: '2',
      skuName: '매직약',
      shortQty: 1,
      expectedArrival: '2026-11-20',
    },
  ],
  ...patch,
});
const item = (patch: Partial<ProgressItem> = {}): ProgressItem => ({
  salesOrderId: 's',
  orderNo: '7429',
  channelOrderId: 'order_1',
  salesChannel: 'medusa',
  customerName: null,
  orderedAt: '',
  state: null,
  stageEnteredAt: '',
  stuck: false,
  settlement: null,
  walletIntentId: null,
  shortage: null,
  cs: null,
  ...patch,
});
const TODAY = '2026-11-24';

it('예약: 모자란 상품·입고 예정을 적고, 지난 예정일은 약속하지 않으며, 나눌 수 있을 때만 먼저 받을지 묻는다', () => {
  const text = customerNotice(
    'reserve',
    item({ shortage: shortage() }),
    [],
    TODAY
  );
  expect(text).toContain('- 고무볼 8개 (11월 28일 입고 예정)');
  expect(text).toContain('- 매직약 1개 (입고 일정 확인 중)');
  expect(text).toContain('먼저 받으시겠어요');
  for (const blocked of [{ splittable: false }, { consolidated: true }])
    expect(
      customerNotice(
        'reserve',
        item({ shortage: shortage(blocked) }),
        [],
        TODAY
      )
    ).not.toContain('먼저');
});

it('추적: 실제로 나간 상자의 송장만 적고, 없으면 만들지 않는다', () => {
  const box = {
    shipmentId: 'b',
    fulfillmentOrderId: 'f',
    status: 'shipped',
    carrier: 'HANJIN',
    trackingNo: '123',
    shippedAt: '2026-11-24T00:00:00Z',
  };
  expect(customerNotice('track', item(), [box], TODAY)).toContain(
    '한진택배 123'
  );
  expect(
    customerNotice('track', item(), [{ ...box, shippedAt: null }], TODAY)
  ).toBeNull();
  expect(customerNotice('track', item(), undefined, TODAY)).toBeNull();
});

it('환불이 막혔거나 분류되지 않은 주문은 사람이 쓴다', () => {
  const settlement = { phase: 'refused' } as ProgressItem['settlement'];
  expect(
    customerNotice('cancel_request', item({ settlement }), [], TODAY)
  ).toBeNull();
  expect(customerNotice('cancel_request', item(), [], TODAY)).toContain(
    '취소 요청'
  );
  expect(customerNotice('unclassified', item(), [], TODAY)).toBeNull();
});
