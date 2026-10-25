import type { SupplierQueueSummary } from '@/lib/types/dto/fulfillment';
import { resolveSupplierId, supplierChipLabel } from './supplier-picker';

const summary = (id: string, name: string, p = 0, f = 0, u = 0): SupplierQueueSummary => ({
  supplierId: id,
  supplierCode: null,
  supplierName: name,
  pendingShipments: p,
  forwardedShipments: f,
  unfulfillableLines: u,
});

describe('supplierChipLabel', () => {
  it('세 수를 다 보인다', () => {
    expect(supplierChipLabel(summary('s', '가나상사', 3, 2, 1))).toBe('가나상사 · 대기 3 · 넘김 2 · 못 보냄 1');
  });
  it('0 인 수는 숨긴다', () => {
    expect(supplierChipLabel(summary('s', '가나상사', 0, 2, 0))).toBe('가나상사 · 넘김 2');
    expect(supplierChipLabel(summary('s', '가나상사'))).toBe('가나상사');
  });
});

describe('resolveSupplierId', () => {
  const list = [summary('s-1', '가'), summary('s-2', '나')];
  it('고르지 않았으면 첫 번째', () => {
    expect(resolveSupplierId(list, null)).toBe('s-1');
    expect(resolveSupplierId(list, '')).toBe('s-1');
  });
  it('고른 것이 있으면 그것', () => {
    expect(resolveSupplierId(list, 's-2')).toBe('s-2');
  });
  it('고른 입점사가 요약에 없어도 그대로 둔다 — 열린 상자가 다 나가도 넘긴 것·올리기는 본다', () => {
    expect(resolveSupplierId(list, 's-9')).toBe('s-9');
  });
  it('요약이 비고 고르지 않았으면 null', () => {
    expect(resolveSupplierId([], null)).toBeNull();
    expect(resolveSupplierId(undefined, null)).toBeNull();
  });
});
