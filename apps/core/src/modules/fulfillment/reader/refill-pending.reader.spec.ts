import { readIntentWorkItemId, readRefills } from './refill-pending.reader';

const refill = { shipmentLineId: 'l', skuId: 's', sourceLocationId: 'loc', locationCode: 'C-07-1', qty: 1 };

describe('readRefills', () => {
  it('채움 결과의 refills 를 돌려준다', () => {
    expect(readRefills({ outcome: 'refilled', refills: [refill] })).toEqual([refill]);
  });
  it.each([
    ['채움이 아니면 빈 목록', { outcome: 'withdrawing', refills: [refill] }],
    ['refills 가 배열이 아니면 빈 목록', { outcome: 'refilled', refills: 'x' }],
    ['스냅샷이 없으면 빈 목록', null],
  ])('%s', (_name, after) => {
    expect(readRefills(after)).toEqual([]);
  });
  it('모양이 틀린 행은 버리고 나머지는 남긴다', () => {
    expect(readRefills({ outcome: 'refilled', refills: [refill, { ...refill, qty: '1' }, 3] })).toEqual([refill]);
  });
});

describe('readIntentWorkItemId', () => {
  it('의도의 작업 항목 id', () => {
    expect(readIntentWorkItemId({ intent: { kind: 'short_pick', workItemId: 'w-1' } })).toBe('w-1');
  });
  it.each([[{ intent: {} }], [{ intent: 'x' }], [null], [{}]])('없으면 null (%j)', (before) => {
    expect(readIntentWorkItemId(before)).toBeNull();
  });
});
