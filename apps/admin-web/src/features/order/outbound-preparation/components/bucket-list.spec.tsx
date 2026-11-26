/** @jest-environment jsdom */
import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { BucketList } from './bucket-list';
import type { PreparationBucketDto } from '@/lib/types/dto/fulfillment';

jest.mock('@/features/order/stock-priority/stock-priority-dialog', () => ({
  StockPriorityDialog: ({ orderText }: { orderText: string }) => (
    <div role="dialog">{`${orderText} 우선할당 창`}</div>
  ),
  StockPriorityCancelDialog: ({ orderText }: { orderText: string }) => (
    <div role="dialog">{`${orderText} 우선할당 취소 창`}</div>
  ),
}));
jest.mock('@/lib/services/orders', () => ({
  useCancelStockPriority: jest.fn(),
  useSetStockPriority: jest.fn(),
  useCreateShipmentConsolidation: jest.fn(),
  useRunOutboundPreparation: jest.fn(),
  useSplitShipment: jest.fn(),
}));
jest.mock('./profile-split-dialog', () => ({
  ProfileSplitDialog: ({
    shipmentId,
    orderText,
    split,
  }: {
    shipmentId: string;
    orderText: string;
    split: { manifestVersion: number } | null;
  }) => (
    <div role="dialog">{`${orderText} ${shipmentId} v${split?.manifestVersion} 나누기 창`}</div>
  ),
}));
let mockCanRun = true;
jest.mock('@/components/auth/can', () => ({
  Can: ({
    children,
    fallback,
  }: {
    children: React.ReactNode;
    fallback?: React.ReactNode;
  }) => (mockCanRun ? children : (fallback ?? null)),
}));
const mockOpen = { replenishment: true };
jest.mock('@/hooks/use-permission', () => ({
  useCanOpen: (screen: string) => ({
    status: 'ready',
    allowed: screen === '/inventory/replenishment' && mockOpen.replenishment,
  }),
}));
beforeEach(() => {
  mockCanRun = true;
  mockOpen.replenishment = true;
});

const shipment = (shipmentId: string, reason: string | null) => ({
  shipmentId,
  orderNos: [shipmentId.toUpperCase()],
  itemSummary: '상품',
  totalQty: 1,
  single: true,
  reason,
});

function list(bucket: PreparationBucketDto) {
  return (
    <BucketList
      bucket={bucket}
      warehouseId="w1"
      selectedIds={[]}
      busy={false}
      onToggle={jest.fn()}
      onToggleAll={jest.fn()}
      onMerge={jest.fn()}
      canPrepare
      onPrepareSeparately={jest.fn()}
    />
  );
}

it('이어서 할 상자는 송장 실패 사유와 상자 상세 링크를 보이고, 사유가 없으면 링크도 없다', () => {
  render(
    list({
      bucket: 'resume',
      count: 2,
      singleCount: 2,
      multiCount: 0,
      shipments: [
        shipment(
          's1',
          '운송사가 송장 번호를 주지 않았어요 (ERROR-01) — 상자 화면에서 확인해요'
        ),
        shipment('s2', null),
      ],
    })
  );

  expect(
    screen.getByText(
      '운송사가 송장 번호를 주지 않았어요 (ERROR-01) — 상자 화면에서 확인해요'
    )
  ).toBeTruthy();
  const links = screen.getAllByRole('link', { name: '상자 상세' });
  expect(links.map((link) => link.getAttribute('href'))).toEqual([
    '/order/fulfillments?shipmentId=s1',
  ]);
});

it('결품 상자, 배치에서 빠져 돌아온 상자, 그 밖의 상자를 나눠 보이고 뺀 때·곳·이유와 다음 할 일을 붙인다', () => {
  const returned = (
    shipmentId: string,
    batchReturn: NonNullable<
      PreparationBucketDto['shipments'][number]['batchReturn']
    >,
    reason: string | null = null
  ) => ({ ...shipment(shipmentId, reason), batchReturn });

  render(
    list({
      bucket: 'resume',
      count: 4,
      singleCount: 4,
      multiCount: 0,
      shortPickCount: 1,
      batchReturnCount: 2,
      shipments: [
        {
          ...shipment('short', null),
          shortPick: [{ name: '상품', locationCode: 'A-01-01', shortQty: 1 }],
          batchReturn: {
            batchNumber: 'OB-1',
            exitedAt: '2026-01-02T01:05:00Z',
            place: '물류앱 피킹',
            reason: '결품 — 재고 부족',
            needsNewWaybill: false,
          },
        },
        returned('voided', {
          batchNumber: 'OB-2',
          exitedAt: '2026-01-02T05:49:00Z',
          place: '물류앱 작업 시작',
          reason: '송장 미발급·재발급 필요',
          needsNewWaybill: true,
        }),
        returned(
          'failed',
          {
            batchNumber: 'OB-3',
            exitedAt: '2026-01-02T06:00:00Z',
            place: null,
            reason: '출고 대상 변경',
            needsNewWaybill: false,
          },
          '운송사가 송장 접수를 거절했어요 — 상자 화면에서 확인해요'
        ),
        shipment('plain', null),
      ],
    })
  );

  const rows = Array.from(document.querySelectorAll('tbody tr')).map(
    (row) => row.textContent
  );

  expect(rows[0]).toBe(
    '결품으로 돌아온 상자 1건 — 자리 수량을 확인한 뒤 하나씩 골라 주세요'
  );
  expect(rows[1]).toContain('결품 — 상품 1개 모자람 (A-01-01)');
  expect(rows[1]).toContain('1월 2일 10:05 · OB-1에서 뺌 · 물류앱 피킹');
  expect(rows[2]).toBe(
    '배치에서 빠져 돌아온 상자 2건 — 뺀 이유를 보고 다시 준비해 주세요'
  );
  expect(rows[3]).toContain('송장 미발급·재발급 필요');
  expect(rows[3]).toContain('1월 2일 14:49 · OB-2에서 뺌 · 물류앱 작업 시작');
  expect(rows[3]).toContain(
    '«이어서 출고 준비»를 누르면 새 송장을 받아 다시 배치에 담아요'
  );
  expect(rows[4]).toContain('1월 2일 15:00 · OB-3에서 뺌');
  expect(rows[4]).toContain('운송사가 송장 접수를 거절했어요');
  expect(rows[4]).not.toContain('«이어서 출고 준비»');
  expect(rows[5]).toBe('그 밖의 상자');
  expect(rows[6]).toContain('-');
});

it('출고를 되돌린 상자를 따로 묶고 되돌린 때·사유·재고가 잡힌 곳과 다음 할 일을 붙인다', () => {
  render(
    list({
      bucket: 'ready',
      count: 2,
      singleCount: 2,
      multiCount: 0,
      shortPickCount: 0,
      batchReturnCount: 0,
      recallReturnCount: 1,
      shipments: [
        {
          ...shipment('recalled', null),
          recallReturn: {
            recalledAt: '2026-01-02T05:49:00Z',
            reasonCode: 'carrier_handoff_failed',
            reason: '택배사 인계 실패',
            needsNewWaybill: true,
          },
        },
        shipment('plain', null),
      ],
    })
  );

  const rows = Array.from(document.querySelectorAll('tbody tr')).map(
    (row) => row.textContent
  );

  expect(rows[0]).toBe(
    '출고를 되돌린 상자 1건 — 되돌린 이유를 보고 다시 준비해 주세요'
  );
  expect(rows[1]).toContain('출고 되돌림 — 택배사 인계 실패');
  expect(rows[1]).toContain(
    '1월 2일 14:49 출고 되돌림 · 돌려받은 상품은 «출고 재작업존» 재고예요'
  );
  expect(rows[1]).toContain(
    '«출고 준비»를 누르면 새 송장을 받아 다시 배치에 담아요'
  );
  expect(rows[2]).toBe('그 밖의 상자');
  expect(
    screen
      .getAllByRole('link', { name: '상자 상세' })
      .map((link) => link.getAttribute('href'))
  ).toEqual(['/order/fulfillments?shipmentId=recalled']);
});

it('출고를 되돌린 뒤 배치에서 다시 빠진 상자는 배치 묶음에 두고 되돌린 사실을 함께 적는다', () => {
  render(
    list({
      bucket: 'ready',
      count: 1,
      singleCount: 1,
      multiCount: 0,
      shortPickCount: 0,
      batchReturnCount: 1,
      recallReturnCount: 0,
      shipments: [
        {
          ...shipment('both', null),
          batchReturn: {
            batchNumber: 'OB-9',
            exitedAt: '2026-01-02T06:00:00Z',
            place: '관리자 출고 배치',
            reason: '잘못 넣은 상자',
            needsNewWaybill: true,
          },
          recallReturn: {
            recalledAt: '2026-01-02T05:49:00Z',
            reasonCode: 'carrier_handoff_failed',
            reason: '택배사 인계 실패',
            needsNewWaybill: true,
          },
        },
      ],
    })
  );

  const rows = Array.from(document.querySelectorAll('tbody tr')).map(
    (row) => row.textContent
  );

  expect(rows[0]).toBe(
    '배치에서 빠져 돌아온 상자 1건 — 뺀 이유를 보고 다시 준비해 주세요'
  );
  expect(rows[1]).toContain('1월 2일 15:00 · OB-9에서 뺌 · 관리자 출고 배치');
  expect(rows[1]).toContain('출고 되돌림 — 택배사 인계 실패');
  expect(rows[1]).toContain('«출고 준비»를 누르면 다시 배치에 담아요');
  expect(rows).toHaveLength(2);
});

it('돌아온 상자가 앞 쪽에서 끝난 쪽은 첫 줄에 «그 밖의 상자»를 단다', () => {
  render(
    list({
      bucket: 'ready',
      count: 3,
      singleCount: 3,
      multiCount: 0,
      shortPickCount: 1,
      batchReturnCount: 1,
      shipments: [shipment('plain', null)],
    })
  );

  const rows = Array.from(document.querySelectorAll('tbody tr')).map(
    (row) => row.textContent
  );

  expect(rows[0]).toBe('그 밖의 상자');
});

it('출고불가 내역은 고를 칸 없이 상품별 재고·모자람과 들어올 예정, 입고 화면 링크를 보인다', () => {
  render(
    list({
      bucket: 'unavailable',
      count: 1,
      singleCount: 0,
      multiCount: 1,
      shipments: [
        {
          ...shipment('s1', null),
          lines: [
            {
              name: '상품 A',
              qty: 5,
              reservedQty: 0,
              stock: {
                onHand: 2,
                reservedByOthers: 2,
                incoming: {
                  inTransit: 3,
                  inTransitEta: '2099-01-05',
                  ordered: 0,
                  inboundShipment: 0,
                  inboundShipmentEta: null,
                },
                elsewhere: { onHand: 0, ordered: 0, orderedEta: null },
              },
            },
            {
              name: '상품 B',
              qty: 1,
              reservedQty: 0,
              stock: {
                onHand: 0,
                reservedByOthers: 0,
                incoming: {
                  inTransit: 0,
                  inTransitEta: null,
                  ordered: 0,
                  inboundShipment: 0,
                  inboundShipmentEta: null,
                },
                elsewhere: { onHand: 0, ordered: 0, orderedEta: null },
              },
            },
          ],
        },
      ],
    })
  );

  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.getByRole('heading').textContent).toBe('출고불가 내역');
  expect(
    screen.getByText('5개 모자람 · 주문 5 · 이 창고 재고 2 (다른 주문 몫 2)')
  ).toBeTruthy();
  expect(
    screen.getByText('5개 모자람 · 주문 5 · 이 창고 재고 2 (다른 주문 몫 2)')
      .className
  ).toContain('text-red-600');
  expect(
    screen.getByText('이 창고로 올 것: 이동 중 3개(1월 5일 도착 예정)')
  ).toBeTruthy();
  expect(screen.getByText('들어올 예정이 없어요')).toBeTruthy();
  expect(
    screen.getByText('발주하거나 다른 창고에서 옮겨 와야 해요')
  ).toBeTruthy();
  expect(
    screen.getByRole('link', { name: '입고 화면' }).getAttribute('href')
  ).toBe('/inventory/inbound');
});

it('정보 부족 내역은 고를 칸 없이 고칠 것과 고치는 곳을 보이고 상품은 SKU 화면으로 잇는다', () => {
  render(
    list({
      bucket: 'needs_info',
      count: 1,
      singleCount: 1,
      multiCount: 0,
      shipments: [
        {
          ...shipment('s1', '배송 프로필이 없는 상품이 있어요'),
          needsInfo: [
            {
              kind: 'shipping_profile_missing',
              skus: [{ name: '상품 A', code: 'A-01' }],
            },
            { kind: 'recipient_incomplete', fields: ['phone', 'postalCode'] },
          ],
        },
      ],
    })
  );

  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(
    screen.getByRole('link', { name: '상품 A' }).getAttribute('href')
  ).toBe('/inventory/skus?code=A-01');
  expect(
    screen.getByText('수령인 정보의 연락처·우편번호 칸이 비어 있어요')
  ).toBeTruthy();
  expect(
    screen.getByText('상자 상세에서 «수령인 변경»으로 채워 주세요')
  ).toBeTruthy();
  expect(
    screen.getByText('모두 고치면 이 상자는 정보 부족에서 빠져요')
  ).toBeTruthy();
  expect(screen.queryByText('배송 프로필이 없는 상품이 있어요')).toBeNull();
  expect(
    screen.getByRole('link', { name: '상자 상세' }).getAttribute('href')
  ).toBe('/order/fulfillments?shipmentId=s1');
});

it('배치에서 돌아온 상자와 결품 상자는 사유가 없어도 상자 상세로 잇는다', () => {
  render(
    list({
      bucket: 'ready',
      count: 3,
      singleCount: 3,
      multiCount: 0,
      shortPickCount: 1,
      batchReturnCount: 1,
      shipments: [
        {
          ...shipment('short', null),
          shortPick: [{ name: '상품', locationCode: 'A-01-01', shortQty: 1 }],
        },
        {
          ...shipment('returned', null),
          batchReturn: {
            batchNumber: 'OB-1',
            exitedAt: '2026-01-02T01:05:00Z',
            place: '관리자 출고 배치',
            reason: '잘못 넣은 상자',
            needsNewWaybill: false,
          },
        },
        shipment('plain', null),
      ],
    })
  );

  expect(
    screen
      .getAllByRole('link', { name: '상자 상세' })
      .map((link) => link.getAttribute('href'))
  ).toEqual([
    '/order/fulfillments?shipmentId=short',
    '/order/fulfillments?shipmentId=returned',
  ]);
});

it('나누기 줄을 받은 정보 부족 상자에만 그 자리에서 나누는 버튼을 두고, 누르면 그 상자의 나누기 창을 연다', () => {
  render(
    list({
      bucket: 'needs_info',
      count: 2,
      singleCount: 2,
      multiCount: 0,
      shipments: [
        {
          ...shipment('mixed', null),
          profileSplit: { manifestVersion: 4, lines: [] },
          needsInfo: [
            {
              kind: 'shipping_profile_mixed',
              skus: [
                { name: '상품 A', code: 'A', profileName: '기본' },
                { name: '상품 B', code: 'B', profileName: '냉장' },
              ],
            },
          ],
        },
        {
          ...shipment('missing', null),
          needsInfo: [
            {
              kind: 'shipping_profile_missing',
              skus: [{ name: '상품 C', code: 'C' }],
            },
          ],
        },
      ],
    })
  );

  const buttons = screen.getAllByRole('button', {
    name: '배송 프로필별로 나누기',
  });
  expect(buttons).toHaveLength(1);
  expect(screen.queryByRole('dialog')).toBeNull();

  fireEvent.click(buttons[0]);
  expect(screen.getByRole('dialog').textContent).toBe(
    '#MIXED mixed v4 나누기 창'
  );
});

const awayStock = (skuId: string | undefined, awayOnHand: number) => ({
  ...(skuId ? { skuId } : {}),
  onHand: 0,
  reservedByOthers: 0,
  incoming: null,
  elsewhere: { onHand: awayOnHand, ordered: 0, orderedEta: null },
});

function unavailable(
  lines: { name: string; stock: ReturnType<typeof awayStock> }[]
) {
  return list({
    bucket: 'unavailable',
    count: 1,
    singleCount: 0,
    multiCount: 1,
    shipments: [
      {
        ...shipment('s1', null),
        lines: lines.map((line) => ({ ...line, qty: 2, reservedQty: 0 })),
      },
    ],
  });
}

it('다른 창고에 재고가 있는 상품만 보충 제안의 그 상품으로 잇는다', () => {
  render(
    unavailable([
      { name: '상품 A', stock: awayStock('sku a', 6) },
      { name: '상품 B', stock: awayStock('sku-b', 0) },
      { name: '상품 C', stock: awayStock(undefined, 3) },
    ])
  );

  expect(
    screen
      .getAllByRole('link', { name: '보충 제안에서 보기' })
      .map((link) => link.getAttribute('href'))
  ).toEqual(['/inventory/replenishment?sku=sku%20a']);
});

it('부분출고는 모자란 상품이 언제 들어오는지 사유 칸에 상품 이름과 함께 보인다', () => {
  render(
    list({
      bucket: 'partial',
      count: 1,
      singleCount: 0,
      multiCount: 1,
      shipments: [
        {
          ...shipment('s1', null),
          lines: [
            { name: '상품 A', qty: 1, reservedQty: 1 },
            {
              name: '상품 B',
              qty: 2,
              reservedQty: 1,
              stock: awayStock('sku-b', 6),
            },
          ],
        },
      ],
    })
  );

  expect(
    screen.getByText(/다른 창고에 6개 — 옮겨 와야 해요/).parentElement
      ?.textContent
  ).toMatch(/^상품 B/);
  expect(
    screen
      .getByRole('link', { name: '보충 제안에서 보기' })
      .getAttribute('href')
  ).toBe('/inventory/replenishment?sku=sku-b');
});

it('한국 날짜로 어제가 예정일이던 발주는 지났다고 보이고, 기다리는 수량보다 적으면 모자란 만큼 보인다', () => {
  jest.useFakeTimers();
  // 한국은 1월 10일 0시 30분
  jest.setSystemTime(new Date('2026-01-09T15:30:00Z'));

  const direct = (skuId: string, orderedEta: string) => ({
    skuId,
    onHand: 0,
    reservedByOthers: 0,
    available: 0,
    waiting: 9,
    incoming: {
      inTransit: 0,
      inTransitEta: null,
      ordered: 6,
      orderedEta,
      inboundShipment: 0,
      inboundShipmentEta: null,
    },
    elsewhere: { onHand: 0, ordered: 0, orderedEta: null },
  });

  try {
    render(
      list({
        bucket: 'unavailable',
        count: 1,
        singleCount: 0,
        multiCount: 1,
        shipments: [
          {
            ...shipment('s1', null),
            lines: [
              {
                name: '상품 A',
                qty: 2,
                reservedQty: 0,
                stock: direct('a', '2026-01-09'),
              },
              {
                name: '상품 B',
                qty: 2,
                reservedQty: 0,
                stock: direct('b', '2026-01-10'),
              },
            ],
          },
        ],
      })
    );

    expect(
      screen.getByText(/발주 6개\(1월 9일 예정이 지났어요\)/).textContent
    ).toContain('모두 9개 기다려 3개 모자라요');
    expect(screen.getByText(/발주 6개\(1월 10일 입고 예정\)/)).toBeTruthy();
  } finally {
    jest.useRealTimers();
  }
});

it('보충 제안 화면을 볼 수 없으면 링크를 보이지 않는다', () => {
  mockOpen.replenishment = false;
  render(unavailable([{ name: '상품 A', stock: awayStock('sku-a', 6) }]));

  expect(screen.getByText(/다른 창고에 6개 — 옮겨 와야 해요/)).toBeTruthy();
  expect(screen.queryByRole('link', { name: '보충 제안에서 보기' })).toBeNull();
});

describe('주문일·경과·받는 분', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-10T12:00:00Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const bucketOf = (
    bucket: PreparationBucketDto['bucket'],
    shipments: PreparationBucketDto['shipments']
  ): PreparationBucketDto => ({
    bucket,
    count: shipments.length,
    singleCount: shipments.length,
    multiCount: 0,
    shipments,
  });

  it('완전출고는 주문일·지난 시간·받는 분을 보이고, 하루 넘게 기다린 주문을 강조한다', () => {
    render(
      list(
        bucketOf('ready', [
          {
            ...shipment('s1', null),
            orderedAt: '2026-01-08T12:00:00Z',
            recipient: { shipmentId: 's1', name: '김*수' },
          },
          {
            ...shipment('s2', null),
            orderedAt: '2026-01-10T09:30:00Z',
            recipient: { shipmentId: 's2', name: '이*희' },
          },
        ])
      )
    );

    screen.getByRole('columnheader', { name: '받는 분' });
    screen.getByText('김*수');
    screen.getByText('이*희');
    expect(screen.getByText('2일 지남').className).toContain('text-amber-700');
    expect(screen.getByText('2시간 30분 지남').className).not.toContain(
      'text-amber-700'
    );
  });

  it('완전출고 밖 분류는 받는 분 칸이 없고, 주문일이 없으면 빈 표시를 한다', () => {
    render(
      list(
        bucketOf('partial', [
          { ...shipment('s3', null), orderedAt: '2026-01-10T11:00:00Z' },
          { ...shipment('s4', null), orderedAt: null },
        ])
      )
    );

    expect(screen.queryByRole('columnheader', { name: '받는 분' })).toBeNull();
    screen.getByRole('columnheader', { name: '주문일' });
    screen.getByText('1시간 지남');
    expect(screen.getAllByText('지남', { exact: false })).toHaveLength(1);
  });

  it('화면을 열어 둔 동안에도 지난 시간이 흐른다', () => {
    render(
      list(
        bucketOf('ready', [
          {
            ...shipment('s5', null),
            orderedAt: '2026-01-09T12:30:00Z',
            recipient: { shipmentId: 's5', name: '박*민' },
          },
        ])
      )
    );

    expect(screen.getByText('23시간 30분 지남').className).not.toContain(
      'text-amber-700'
    );

    React.act(() => {
      jest.advanceTimersByTime(31 * 60_000);
    });

    expect(screen.getByText('1일 지남').className).toContain('text-amber-700');
  });
});

it('나눈 상자는 사유 칸에 나눈 이유를 보이고, 다른 사유가 있으면 그 아래에 붙인다', () => {
  const split = (reason: string | null) => ({
    boxQty: 1,
    orderQty: 2,
    boxNo: 1,
    boxCount: 2,
    reasonCode: null,
    reason,
  });

  render(
    list({
      bucket: 'resume',
      count: 3,
      singleCount: 3,
      multiCount: 0,
      shipments: [
        { ...shipment('s1', null), split: split('한 상자에 다 들어가지 않음') },
        {
          ...shipment('s2', '운송사가 송장 번호를 주지 않았어요'),
          split: split('고객이 일부 먼저 보내 달라고 요청'),
        },
        { ...shipment('s3', null), split: split(null) },
      ],
    })
  );

  const headers = screen.getAllByRole('columnheader');
  const reasonColumn = headers.findIndex((cell) => cell.textContent === '사유');
  const rows = screen.getAllByRole('row').slice(1);
  const reasonOf = (index: number) =>
    rows[index].querySelectorAll('td')[reasonColumn]?.textContent;

  expect(reasonOf(0)).toBe('나눈 이유 · 한 상자에 다 들어가지 않음');
  expect(reasonOf(1)).toBe(
    '운송사가 송장 번호를 주지 않았어요나눈 이유 · 고객이 일부 먼저 보내 달라고 요청'
  );
  expect(reasonOf(2)).toBe('-');
});

it('못 나가는 상자에서 우선할당을 열고, 우선할당한 상자는 표시와 취소를 보인다', () => {
  render(
    list({
      bucket: 'partial',
      count: 2,
      singleCount: 2,
      multiCount: 0,
      shipments: [
        { ...shipment('s1', null), stockPriority: false },
        { ...shipment('s2', null), stockPriority: true },
      ],
    })
  );

  const buttons = screen.getAllByRole('button', { name: /우선할당/ });
  expect(buttons.map((button) => button.textContent)).toEqual([
    '우선할당',
    '우선할당 취소',
  ]);
  fireEvent.click(buttons[0]);
  expect(screen.getByRole('dialog').textContent).toBe('#S1 우선할당 창');
  fireEvent.click(buttons[1]);
  expect(screen.getByRole('dialog').textContent).toBe('#S2 우선할당 취소 창');
});

it('나갈 수 있는 상자에는 우선할당을 두지 않고, 표시한 상자의 취소만 둔다', () => {
  render(
    list({
      bucket: 'ready',
      count: 2,
      singleCount: 2,
      multiCount: 0,
      shipments: [
        { ...shipment('s1', null), stockPriority: false },
        { ...shipment('s2', null), stockPriority: true },
      ],
    })
  );

  expect(
    screen
      .getAllByRole('button', { name: /우선할당/ })
      .map((button) => button.textContent)
  ).toEqual(['우선할당 취소']);
});

it('우선할당 권한이 없으면 버튼 대신 담당자에게 알리라고 안내한다', () => {
  mockCanRun = false;
  render(
    list({
      bucket: 'unavailable',
      count: 1,
      singleCount: 1,
      multiCount: 0,
      shipments: [{ ...shipment('s1', null), stockPriority: false }],
    })
  );

  expect(screen.queryByRole('button', { name: '우선할당' })).toBeNull();
  expect(
    screen.getByText(/우선할당할 수 있는 담당자에게 알려 주세요/)
  ).toBeTruthy();
});

it('재고를 내준 상자는 언제 어느 주문에 내줬는지 보인다', () => {
  render(
    list({
      bucket: 'unavailable',
      count: 1,
      singleCount: 1,
      multiCount: 0,
      shipments: [
        {
          ...shipment('s1', null),
          stockPriority: false,
          stockGiven: { at: '2026-01-05T03:04:00Z', orderNos: ['B-1'] },
        },
      ],
    })
  );

  expect(
    screen.getByText(/우선할당한 주문\(#B-1\)에 재고를 내줬어요/)
  ).toBeTruthy();
});

it('부분출고는 모자란 상품 줄만 빨갛게 수량과 함께, 다 있는 줄은 이름만 흐리게 보인다', () => {
  render(
    list({
      bucket: 'partial',
      count: 1,
      singleCount: 0,
      multiCount: 1,
      shipments: [
        {
          ...shipment('s1', null),
          lines: [
            { name: '상품 A', qty: 1, reservedQty: 1 },
            {
              name: '상품 B',
              qty: 3,
              reservedQty: 1,
              stock: awayStock('sku-b', 6),
            },
          ],
        },
      ],
    })
  );

  const items = screen.getAllByRole('listitem');

  expect(items[0].textContent).toBe('상품 B3개 중 1개 있음 · 2개 모자람');
  expect(items[0].className).toContain('text-red-600');
  expect(items[1].textContent).toBe('상품 A1개 있음');
  expect(screen.getByText('1개 있음').className).toContain(
    'text-muted-foreground'
  );
  expect(screen.getByText('1종 모자람 · 2개')).toBeTruthy();
  expect(screen.getByText('1종 다 있음')).toBeTruthy();
});

it('부분출고 수량 칸은 지금 보낼 수와 전체를 함께 보인다', () => {
  render(
    list({
      bucket: 'partial',
      count: 1,
      singleCount: 0,
      multiCount: 1,
      shipments: [
        {
          ...shipment('s1', null),
          totalQty: 4,
          lines: [
            { name: '상품 A', qty: 1, reservedQty: 1 },
            { name: '상품 B', qty: 3, reservedQty: 1 },
          ],
        },
      ],
    })
  );

  expect(screen.getByText('전체 4').previousElementSibling?.textContent).toBe(
    '2'
  );
});

it('부분출고 사유 칸은 사유가 같은 상품을 옵션 이름으로 묶고 상태와 할 일을 나눈다', () => {
  const none = {
    onHand: 0,
    reservedByOthers: 0,
    waiting: 1,
    incoming: {
      inTransit: 0,
      inTransitEta: null,
      ordered: 0,
      inboundShipment: 0,
      inboundShipmentEta: null,
    },
    elsewhere: { onHand: 0, ordered: 0, orderedEta: null },
  };

  render(
    list({
      bucket: 'partial',
      count: 1,
      singleCount: 0,
      multiCount: 1,
      shipments: [
        {
          ...shipment('s1', null),
          lines: [
            { name: '펌제 [리뉴얼 2제]', qty: 2, reservedQty: 1, stock: none },
            { name: '클리닉 패드', qty: 2, reservedQty: 1, stock: none },
          ],
        },
      ],
    })
  );

  expect(screen.getByText('리뉴얼 2제 · 클리닉 패드')).toBeTruthy();
  expect(screen.getAllByText('들어올 예정이 없어요')).toHaveLength(1);
  expect(
    screen.getByText('기다리는 1개만큼 발주하거나 다른 창고에서 옮겨 와야 해요')
  ).toBeTruthy();
});

it('부분출고에 모자란 줄이 없으면 이름만 흐리게 보인다', () => {
  render(
    list({
      bucket: 'partial',
      count: 1,
      singleCount: 1,
      multiCount: 0,
      shipments: [
        {
          ...shipment('s1', null),
          lines: [{ name: '상품 A', qty: 2, reservedQty: 2 }],
        },
      ],
    })
  );

  expect(screen.getByText('상품 A').className).toContain(
    'text-muted-foreground'
  );
  expect(screen.queryByText(/모자람/)).toBeNull();
});

it('출고불가에서 stock 없는 모자란 줄은 이름만 빨갛게 보인다', () => {
  render(
    list({
      bucket: 'unavailable',
      count: 1,
      singleCount: 0,
      multiCount: 1,
      shipments: [
        {
          ...shipment('s1', null),
          lines: [
            {
              name: '상품 A',
              qty: 2,
              reservedQty: 0,
              stock: awayStock('sku-a', 1),
            },
            { name: '상품 B', qty: 1, reservedQty: 0 },
          ],
        },
      ],
    })
  );

  expect(screen.getAllByText('상품 A')[0].className).toContain('text-red-600');
  expect(screen.getByText('상품 B').className).toContain('text-red-600');
  expect(screen.getAllByText(/개 모자람 ·/)).toHaveLength(1);
});
