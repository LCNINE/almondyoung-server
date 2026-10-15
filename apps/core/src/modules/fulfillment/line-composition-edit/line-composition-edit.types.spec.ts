import { classifyExistingLine, isBlockingBox } from './line-composition-edit.types';

const a1 = [{ skuId: 'a', qtyPerUnit: 1 }];
const b1 = [{ skuId: 'b', qtyPerUnit: 1 }];

describe('classifyExistingLine', () => {
  it.each([
    [{ source: 'operator' as const, frozen: a1, next: b1, blocked: false }, 'operator'],
    [{ source: 'operator' as const, frozen: a1, next: a1, blocked: true }, 'operator'],
    [{ source: 'matching' as const, frozen: a1, next: a1, blocked: true }, 'same'],
    [{ source: 'matching' as const, frozen: a1, next: b1, blocked: true }, 'in_progress'],
    [{ source: 'matching' as const, frozen: a1, next: b1, blocked: false }, 'changeable'],
  ])('%j → %s', (input, expected) => {
    expect(classifyExistingLine(input)).toBe(expected);
  });
});

describe('isBlockingBox', () => {
  it('draft 이고 작업·송장이 없을 때만 막지 않는다', () => {
    expect(isBlockingBox({ shipmentId: 's', status: 'draft', batchId: null, hasActiveWaybill: false })).toBe(false);
    expect(isBlockingBox({ shipmentId: 's', status: 'planned', batchId: null, hasActiveWaybill: false })).toBe(true);
    expect(isBlockingBox({ shipmentId: 's', status: 'draft', batchId: 'b', hasActiveWaybill: false })).toBe(true);
    expect(isBlockingBox({ shipmentId: 's', status: 'draft', batchId: null, hasActiveWaybill: true })).toBe(true);
  });
});
