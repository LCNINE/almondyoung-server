import { blockerLabel, dismissedLabel, isConflict, resyncLabel, summarizeDelta, toAmendmentPage, toAmendmentRecords } from './sales-order-amendments.shape';

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

describe('resyncLabel', () => {
  const now = new Date('2026-10-06T10:00:00.000Z');

  it.each([
    [null, null],
    [undefined, null],
    ['not-a-date', null],
    ['2026-10-06T09:59:40.000Z', '확인 요청 방금'],
    ['2026-10-06T09:55:00.000Z', '확인 요청 5분 전'],
    ['2026-10-06T07:00:00.000Z', '확인 요청 3시간 전'],
    ['2026-10-04T10:00:00.000Z', '확인 요청 2일 전'],
  ])('%s → %s', (requestedAt, expected) => {
    expect(resyncLabel(requestedAt, now)).toBe(expected);
  });
});

describe('dismissedLabel', () => {
  it('메모가 있으면 붙이고 없으면 날짜까지만', () => {
    expect(dismissedLabel({ dismissedAt: '2026-10-06T01:00:00.000Z', dismissNote: '채널 쪽 오류' })).toBe('무시됨 · 10. 6. · 채널 쪽 오류');
    expect(dismissedLabel({ dismissedAt: '2026-10-06T01:00:00.000Z', dismissNote: null })).toBe('무시됨 · 10. 6.');
    expect(dismissedLabel({ dismissedAt: null, dismissNote: null })).toBe('무시됨');
  });
});

describe('isConflict', () => {
  it('409 — 이미 닫혔거나 대체된 행. 목록을 다시 읽는 것으로 끝난다', () => {
    expect(isConflict({ response: { status: 409, data: { message: 'not pending' } } })).toBe(true);
    expect(isConflict({ statusCode: 409, message: 'not pending' })).toBe(true); // 인터셉터가 정규화한 CustomError
  });

  it.each([
    ['500', { response: { status: 500 } }],
    ['403', { response: { status: 403 } }],
    ['404', { response: { status: 404 } }],
    ['응답 없음(네트워크)', new Error('Network Error')],
    ['undefined', undefined],
  ])('그 밖(%s)은 409 가 아니다 — 알려야 한다', (_label, error) => {
    expect(isConflict(error)).toBe(false);
  });
});
