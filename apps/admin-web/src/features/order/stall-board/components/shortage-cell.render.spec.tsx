/** @jest-environment jsdom */

import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReserveShortageView } from '@/lib/api/domains/orders/order-progress.shape';
import { ShortageCell } from './shortage-cell';

const item = (n: number, expectedArrival: string | null = null) => ({
  skuId: `k${n}`,
  skuName: `품목${n}`,
  shortQty: n,
  expectedArrival,
});

const shortage = (
  items: ReserveShortageView['items']
): ReserveShortageView => ({
  shipmentId: 'box 1',
  manifestVersion: 1,
  consolidated: false,
  splittable: true,
  skuKinds: 10,
  shortSkuKinds: items.length,
  items,
});

// 한국은 10월 26일
const NOW = new Date('2026-10-25T15:30:00Z');
const rows = () =>
  within(screen.getByRole('list', { name: '모자란 상품' }))
    .getAllByRole('listitem')
    .map((row) => row.textContent);

it('모자란 상품이 셋 이상이면 첫 상품만 보이고, 누르면 줄 안에서 전부 펼치고 다시 접는다', () => {
  render(
    <ShortageCell
      shortage={shortage([
        item(3, '2026-10-27'),
        item(2, '2026-10-25'),
        item(1),
      ])}
      now={NOW}
    />
  );

  expect(screen.getByText('10종 중 3종')).toBeTruthy();
  expect(rows()).toEqual(['품목3 3개 입고 10-27']);

  const toggle = screen.getByRole('button', { name: '외 2개 보기' });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(toggle);

  expect(rows()).toEqual([
    '품목3 3개 입고 10-27',
    '품목2 2개 10-25 예정이 지남',
    '품목1 1개 입고 예정일 없음',
  ]);

  const close = screen.getByRole('button', { name: '접기' });
  expect(close.getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(close);
  expect(rows()).toEqual(['품목3 3개 입고 10-27']);
});

it('둘까지는 접지 않고 상품마다 입고 예정을 보인다', () => {
  render(
    <ShortageCell
      shortage={shortage([item(3), item(1, '2026-10-26')])}
      now={NOW}
    />
  );

  expect(rows()).toEqual([
    '품목3 3개 입고 예정일 없음',
    '품목1 1개 입고 10-26',
  ]);
  expect(screen.queryByRole('button')).toBeNull();
});

it('그 상자의 상세로 잇는다', () => {
  render(<ShortageCell shortage={shortage([item(1)])} now={NOW} />);

  expect(
    screen.getByRole('link', { name: '상자 상세' }).getAttribute('href')
  ).toBe('/order/fulfillments?shipmentId=box%201');
});
