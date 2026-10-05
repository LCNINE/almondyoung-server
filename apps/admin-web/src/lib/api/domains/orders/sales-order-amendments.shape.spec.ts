import { blockerLabel, summarizeDelta, toAmendmentPage, toAmendmentRecords } from './sales-order-amendments.shape';

describe('toAmendmentPage', () => {
  const page = { items: [{ id: 'a1', salesOrderId: 's1', salesChannel: 'medusa', channelOrderId: 'o1', displayOrderNo: '2332', origin: 'channel', status: 'pending', deltas: [], occurredAt: '2026-10-05T00:00:00.000Z' }], nextCursor: null };

  it('인터셉터가 벗긴 모양과 안 벗긴 모양을 모두 받는다', () => {
    expect(toAmendmentPage(page).items).toHaveLength(1);
    expect(toAmendmentPage({ success: true, data: page }).items).toHaveLength(1);
  });

  it('모양이 틀리면 빈 쪽 — 표가 조용히 깨지지 않게', () => {
    expect(toAmendmentPage(undefined)).toEqual({ items: [], nextCursor: null });
  });

  it('nextCursor 문자열은 보존한다', () => {
    expect(toAmendmentPage({ items: [], nextCursor: 'c1' }).nextCursor).toBe('c1');
  });
});

describe('toAmendmentRecords', () => {
  it('배열 또는 { data: 배열 }', () => {
    expect(toAmendmentRecords([{ id: 'a' }])).toHaveLength(1);
    expect(toAmendmentRecords({ success: true, data: [{ id: 'a' }] })).toHaveLength(1);
    expect(toAmendmentRecords(null)).toEqual([]);
  });
});

describe('summarizeDelta', () => {
  it.each([
    [{ type: 'shipping_address_change', before: { roadAddress: '서울', detailAddress: '1' }, after: { roadAddress: '부산', detailAddress: '2' } }, '배송지 서울 1 → 부산 2'],
    [{ type: 'quantity_correction', channelOrderItemId: 'ci', quantityBefore: 2, correctedQuantity: 0 }, '라인 ci 제거 (2 → 0)'],
    [{ type: 'quantity_correction', channelOrderItemId: 'ci', quantityBefore: 2, correctedQuantity: 1 }, '라인 ci 수량 2 → 1'],
    [{ type: 'add_product', channelOrderItemId: 'ci', quantity: 3 }, '라인 ci 추가 ×3'],
    [{ type: 'replace_product', channelOrderItemId: 'ci', channelProductIdBefore: 'a', channelProductIdAfter: 'b' }, '라인 ci 상품 a → b'],
    [{ type: 'amount_correction', channelOrderItemId: 'ci', unitPriceBefore: 1000, unitPriceAfter: 900 }, '라인 ci 단가 1,000 → 900'],
    [{ type: 'unmatched_line' }, '채널 라인 id 없는 라인'],
    [{ type: 'mystery' }, 'mystery'],
  ])('%j', (delta, expected) => {
    expect(summarizeDelta(delta)).toBe(expected);
  });
});

describe('blockerLabel', () => {
  it('아는 코드는 한국어, 모르는 코드는 그대로', () => {
    expect(blockerLabel('WAYBILL_ISSUED')).toBe('송장 발급됨');
    expect(blockerLabel('NEW_CODE')).toBe('NEW_CODE');
  });
});
