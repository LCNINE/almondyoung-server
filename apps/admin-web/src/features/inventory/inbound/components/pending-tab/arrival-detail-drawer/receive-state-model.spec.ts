import { getReceiveDraft, updateReceiveDraft } from './receive-state-model';

describe('expected-arrival 수령 폼 상태', () => {
  it('위치나 메모를 먼저 바꿔도 수량은 현재 잔량으로 시작한다', () => {
    const withLocation = updateReceiveDraft({}, 'po-1', 'sku-1', 7, 'locationId', 'location-1');
    const withMemo = updateReceiveDraft({}, 'po-1', 'sku-1', 7, 'memo', '검수 필요');

    expect(getReceiveDraft(withLocation, 'po-1', 'sku-1', 7)).toEqual({
      quantity: 7,
      locationId: 'location-1',
      memo: '',
    });
    expect(getReceiveDraft(withMemo, 'po-1', 'sku-1', 7)).toEqual({
      quantity: 7,
      locationId: '',
      memo: '검수 필요',
    });
  });

  it('같은 SKU라도 발주 문서가 다르면 상태를 공유하지 않는다', () => {
    const first = updateReceiveDraft({}, 'po-1', 'sku-1', 7, 'quantity', 2);

    expect(getReceiveDraft(first, 'po-2', 'sku-1', 11)).toEqual({
      quantity: 11,
      locationId: '',
      memo: '',
    });
  });
});
