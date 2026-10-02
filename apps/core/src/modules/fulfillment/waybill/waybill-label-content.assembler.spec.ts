import { ConflictError } from '@app/shared';
import { assertLabelAllocated, isAppPrintable, requirePrintable } from './waybill-label-content.assembler';

const allocation = (over = {}) => ({
  workItemId: 'wi-1',
  batchStarted: true,
  withdrawing: false,
  lines: [{ id: 'l1', qty: 2 }],
  rows: [{ shipmentLineId: 'l1', locationCode: 'A-01', skuId: 's1', skuName: '펜', qty: 2 }],
  ...over,
});

describe('assertLabelAllocated (I4)', () => {
  it('시작된 배치의 활성 작업 항목이 줄 수량을 덮으면 통과', () => {
    expect(() => assertLabelAllocated('shp', allocation())).not.toThrow();
  });
  it.each([
    ['작업 항목 없음', { workItemId: null }],
    ['시작 전 배치', { batchStarted: false }],
    ['I4 — 이탈 중인 박스는 배정이 남아 있어도 그리지 않는다', { withdrawing: true }],
    ['배정 < 줄 수량', { rows: [{ shipmentLineId: 'l1', locationCode: 'A-01', skuId: 's1', skuName: '펜', qty: 1 }] }],
    [
      '배정 없는 줄',
      {
        lines: [
          { id: 'l1', qty: 2 },
          { id: 'l2', qty: 1 },
        ],
      },
    ],
  ])('%s 이면 409 WAYBILL_LABEL_NOT_ALLOCATED', (_label, over) => {
    const run = () => assertLabelAllocated('shp', allocation(over));
    expect(run).toThrow(ConflictError);
    expect(run).toThrow(/^WAYBILL_LABEL_NOT_ALLOCATED:/);
  });
});

describe('isAppPrintable', () => {
  it.each([
    [{ source: 'carrier' as const, carrier: 'HANJIN' as const }, true],
    [{ source: 'manual' as const, carrier: 'HANJIN' as const }, false],
    [{ source: 'carrier' as const, carrier: 'CJ' as const }, false],
  ])('%o → %s', (wb, expected) => expect(isAppPrintable(wb)).toBe(expected));
});

describe('requirePrintable', () => {
  it('external 이면 409 WAYBILL_LABEL_UNAVAILABLE', () => {
    const run = () =>
      requirePrintable({ kind: 'external', waybill: { id: 'w', source: 'manual', carrier: 'HANJIN' } as never });
    expect(run).toThrow(/WAYBILL_LABEL_UNAVAILABLE/);
  });
});
