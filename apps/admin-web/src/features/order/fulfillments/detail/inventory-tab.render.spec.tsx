/**
 * @jest-environment jsdom
 */
import { render } from '@testing-library/react';
import type { FulfillmentOrderDetail } from '@/lib/types/dto/fulfillment';
import { InventoryTab } from './inventory-tab';

const fo = {
  id: 'fo-1',
  warehouseName: '샘플 창고',
  blockedReasons: ['SHIPPED_EVIDENCE'],
  items: [
    {
      id: 'item-uuid-1',
      skuId: 'sku-uuid-1',
      skuCode: 'SAMPLE-RED',
      skuName: '샘플 상품 (빨강)',
      qty: 3,
      reservedQty: 1,
      pickedQty: 0,
      shippedQty: 0,
      status: 'partially_reserved',
    },
  ],
  reservations: [
    {
      id: 'res-uuid-1',
      fulfillmentOrderItemId: 'item-uuid-1',
      skuId: 'sku-uuid-1',
      warehouseId: 'wh-uuid-1',
      quantity: 1,
      status: 'confirmed',
    },
  ],
} as unknown as FulfillmentOrderDetail;

it('상품명과 한국어 상태로 재고 확보를 보이고 내부 번호는 감춘다', () => {
  const { container } = render(<InventoryTab fo={fo} />);
  const text = container.textContent ?? '';

  for (const expected of [
    '이미 출고된 상품이 있어요.',
    '상품별 재고 확보',
    '샘플 상품 (빨강)',
    'SAMPLE-RED',
    '부분 확보',
    '재고 확보 기록',
    '확보됨',
    '샘플 창고',
  ]) {
    expect(text).toContain(expected);
  }
  expect(text).not.toMatch(
    /uuid|FOI|SKU ID|SHIPPED_EVIDENCE|partially_reserved|confirmed|레코드|qty/
  );
});

it('출고하거나 취소한 수량은 부족으로 세지 않는다', () => {
  const done = {
    ...fo,
    blockedReasons: [],
    items: [
      { ...fo.items[0], qty: 3, reservedQty: 0, shippedQty: 2, canceledQty: 1 },
    ],
  } as unknown as FulfillmentOrderDetail;
  const { container } = render(<InventoryTab fo={done} />);
  const cells = Array.from(
    container.querySelectorAll('tbody tr')[0].querySelectorAll('td')
  ).map((cell) => cell.textContent);

  // 상품 · 필요 · 확보 · 부족 · 출고 · 상태
  expect(cells.slice(1, 5)).toEqual(['3', '0', '0', '2']);
});
