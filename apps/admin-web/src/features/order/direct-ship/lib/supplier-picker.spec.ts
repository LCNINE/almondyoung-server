import type { SupplierDto } from '@/lib/types/dto/inventory';
import type { SupplierQueueSummary } from '@/lib/types/dto/fulfillment';
import { resolveTab, supplierChipLabel, supplierPickerView } from './supplier-picker';

const summary = (id: string, name: string, p = 0, f = 0, u = 0): SupplierQueueSummary => ({
  supplierId: id,
  supplierCode: null,
  supplierName: name,
  pendingShipments: p,
  forwardedShipments: f,
  unfulfillableLines: u,
});

const supplier = (id: string, name: string, isDirectDelivery: boolean | null = true): SupplierDto => ({
  id,
  name,
  contact: null,
  address: null,
  businessInfo: null,
  purchaseSettings: { isDirectDelivery, orderCutoffTime: null },
  paymentInfo: null,
  description: null,
  memo: null,
  purchaseManagerId: null,
  defaultWarehouseId: null,
  categories: [],
  createdAt: '2026-10-26T00:00:00Z',
  updatedAt: '2026-10-26T00:00:00Z',
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

describe('supplierPickerView', () => {
  const summaries = [summary('s-1', '가', 2), summary('s-2', '나', 0, 1)];
  const directs = [supplier('s-2', '나'), supplier('s-3', '다'), supplier('s-1', '가')];

  it('칩 = 요약(앞, 그 순서) + 열린 상자 없는 직배 입점사(뒤, 0)', () => {
    const view = supplierPickerView({ summaries, summariesReady: true, directSuppliers: directs, requested: 's-1' });
    expect(view.chips).toEqual([summary('s-1', '가', 2), summary('s-2', '나', 0, 1), summary('s-3', '다')]);
  });

  it('직배가 아닌 행은 칩이 되지 않는다 — 파라미터를 버린 옛 core 가 전부를 돌려줘도', () => {
    const view = supplierPickerView({
      summaries: [],
      summariesReady: true,
      directSuppliers: [supplier('n-1', '일반', false), supplier('d-1', '직배')],
      requested: null,
    });
    expect(view.chips.map((c) => c.supplierId)).toEqual(['d-1']);
  });

  it('고르지 않았으면 첫 칩을 고르고 URL 에 적으라고 한다', () => {
    expect(
      supplierPickerView({ summaries, summariesReady: true, directSuppliers: directs, requested: null })
    ).toMatchObject({ selectedId: 's-1', writeToUrl: true });
    expect(
      supplierPickerView({ summaries, summariesReady: true, directSuppliers: directs, requested: '' })
    ).toMatchObject({ selectedId: 's-1', writeToUrl: true });
  });

  it('고른 것이 있으면 그것, URL 은 그대로', () => {
    expect(
      supplierPickerView({ summaries, summariesReady: true, directSuppliers: directs, requested: 's-2' })
    ).toMatchObject({ selectedId: 's-2', writeToUrl: false });
  });

  it('마지막 열린 상자를 발송해 요약에서 빠져도 그 입점사에 머물고 칩도 남는다', () => {
    // 적용 전: s-1 이 요약에 있다 → 적용 뒤 s-1 이 요약에서 빠졌다
    const view = supplierPickerView({
      summaries: [summary('s-2', '나', 0, 1)],
      summariesReady: true,
      directSuppliers: directs,
      requested: 's-1',
    });
    expect(view.selectedId).toBe('s-1');
    expect(view.chips.find((c) => c.supplierId === 's-1')).toEqual(summary('s-1', '가'));
  });

  it('열린 상자가 하나도 없어도 직배 입점사가 있으면 첫 입점사를 고른다(송장 정정 올리기로 갈 수 있게)', () => {
    expect(
      supplierPickerView({ summaries: [], summariesReady: true, directSuppliers: directs, requested: null })
    ).toMatchObject({ selectedId: 's-2', writeToUrl: true });
  });

  it('요약이 오기 전에는 기본값을 정하지 않는다 — 직배 목록만 보고 고른 입점사가 URL 에 박히지 않게', () => {
    expect(
      supplierPickerView({ summaries: undefined, summariesReady: false, directSuppliers: directs, requested: null })
    ).toMatchObject({ selectedId: null, writeToUrl: false });
  });

  it('고른 입점사가 어느 목록에도 없으면(목록 권한 없음 등) 짧은 id 칩을 더한다', () => {
    const view = supplierPickerView({
      summaries,
      summariesReady: true,
      directSuppliers: undefined,
      requested: 'abcdef12-9999',
    });
    expect(view.selectedId).toBe('abcdef12-9999');
    expect(view.chips.at(-1)).toEqual(summary('abcdef12-9999', 'abcdef12…'));
  });

  it('직배 입점사도 요약도 없으면 칩도 고른 것도 없다', () => {
    expect(
      supplierPickerView({ summaries: [], summariesReady: true, directSuppliers: [], requested: null })
    ).toEqual({ chips: [], selectedId: null, writeToUrl: false });
  });
});

describe('resolveTab', () => {
  it('모르는 값·없음은 대기', () => {
    expect(resolveTab(null, true)).toBe('pending');
    expect(resolveTab('direct-ship', true)).toBe('pending');
  });
  it('아는 탭은 그대로', () => {
    expect(resolveTab('handoffs', false)).toBe('handoffs');
    expect(resolveTab('cancel-notices', false)).toBe('cancel-notices');
    expect(resolveTab('upload', true)).toBe('upload');
  });
  it('올리기 권한 없이 연 ?tab=upload 는 대기 — 탭이 안 보이는데 빈 화면이 되지 않게', () => {
    expect(resolveTab('upload', false)).toBe('pending');
  });
});
