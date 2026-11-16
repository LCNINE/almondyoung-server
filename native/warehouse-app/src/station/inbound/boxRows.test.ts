import { describe, expect, it } from 'vitest';
import { blockNotice } from './boxRows';

describe('blockNotice', () => {
  it('까닭마다 한 줄과 커서를 옮길 줄', () => {
    expect(blockNotice({ reason: 'blank', lineIds: ['L2', 'L3'] })).toEqual({ message: '빈칸 2줄', focus: 'line:L2' });
    expect(blockNotice({ reason: 'stale_list', lineIds: ['L4'] })).toEqual({
      message: '리스트가 바뀌었어요 — 1줄 다시 확인',
      focus: 'line:L4',
    });
    expect(blockNotice({ reason: 'unplanned_on_list', skuIds: ['sku-9'] })).toEqual({
      message: '리스트에 있는 상품이에요 — 리스트에 없던 물건에서 빼고 그 줄에 넣어 주세요',
      focus: 'unplanned:sku-9',
    });
    expect(blockNotice({ reason: 'empty_added_box' })).toEqual({ message: '리스트에 없던 물건을 하나 이상 넣어 주세요' });
    expect(blockNotice({ reason: 'unresolved' })).toEqual({ message: '관리자 화면에서 줄을 정해야 해요' });
  });

  it('열린 재고 상자가 아니면 문구 대신 다시 연다(null)', () => {
    expect(blockNotice({ reason: 'not_stock_open' })).toBeNull();
  });
});
