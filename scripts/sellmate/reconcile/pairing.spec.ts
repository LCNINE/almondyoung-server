import { compareWithState, pairItems, CoreIndex, Pair, StateRow } from './pairing';
import type { SellmateStockRow } from './stock-csv';

const row = (optionSerial: string, barcode: string, over: Partial<SellmateStockRow> = {}): SellmateStockRow => ({
  optionSerial,
  productSerial: 'P-1',
  name: `TEST-${optionSerial}`,
  barcode,
  current: 0,
  unshipped: 0,
  ...over,
});

const core = (codes: Record<string, string>, barcodes: Record<string, string[]>): CoreIndex => ({
  skuIdByCode: new Map(Object.entries(codes)),
  skuIdsByBarcode: new Map(Object.entries(barcodes)),
});

describe('pairItems', () => {
  it('code 가 core SKU 와 일치하면 code 로 짝짓는다', () => {
    const r = pairItems([row('TEST-0001', '8800000000001')], core({ 'TEST-0001': 'skuA' }, {}));
    expect(r.unpaired).toEqual([]);
    expect(r.pairs).toEqual([expect.objectContaining({ optionSerial: 'TEST-0001', skuId: 'skuA', matchedBy: 'code' })]);
  });

  it('code 가 없고 바코드가 core SKU 하나면 barcode 로 짝짓는다', () => {
    const r = pairItems([row('TEST-0001', '8800000000001')], core({}, { '8800000000001': ['skuB'] }));
    expect(r.pairs).toEqual([expect.objectContaining({ skuId: 'skuB', matchedBy: 'barcode' })]);
  });

  it('둘 다 없으면 no_core_sku', () => {
    const r = pairItems([row('TEST-0001', '8800000000001')], core({}, {}));
    expect(r.pairs).toEqual([]);
    expect(r.unpaired).toEqual([expect.objectContaining({ reason: 'no_core_sku', skuId: null })]);
  });

  it('바코드가 core SKU 둘이면 core_barcode_ambiguous', () => {
    const r = pairItems([row('TEST-0001', '8800000000001')], core({}, { '8800000000001': ['skuA', 'skuB'] }));
    expect(r.unpaired).toEqual([expect.objectContaining({ reason: 'core_barcode_ambiguous' })]);
  });

  it('바코드가 비면 code 가 일치해도 empty_barcode', () => {
    const r = pairItems([row('TEST-0001', '')], core({ 'TEST-0001': 'skuA' }, {}));
    expect(r.pairs).toEqual([]);
    expect(r.unpaired).toEqual([expect.objectContaining({ reason: 'empty_barcode', skuId: 'skuA' })]);
  });

  it('셀메이트 두 옵션이 같은 바코드면 둘 다 barcode_shared', () => {
    const r = pairItems(
      [row('TEST-0001', '8800000000001'), row('TEST-0002', '8800000000001')],
      core({ 'TEST-0001': 'skuA', 'TEST-0002': 'skuB' }, {}),
    );
    expect(r.pairs).toEqual([]);
    expect(r.unpaired.map((u) => u.reason)).toEqual(['barcode_shared', 'barcode_shared']);
  });

  it('code 로 skuA, 바코드로 skuB 면 code_barcode_conflict', () => {
    const r = pairItems(
      [row('TEST-0001', '8800000000001')],
      core({ 'TEST-0001': 'skuA' }, { '8800000000001': ['skuB'] }),
    );
    expect(r.unpaired).toEqual([expect.objectContaining({ reason: 'code_barcode_conflict', skuId: 'skuA' })]);
  });

  it('code 는 skuA 이고 바코드가 core 에 없으면 충돌이 아니라 code 일치', () => {
    const r = pairItems([row('TEST-0001', '8800000000001')], core({ 'TEST-0001': 'skuA' }, {}));
    expect(r.pairs).toHaveLength(1);
  });

  it('두 옵션이 같은 SKU 면 둘 다 sku_shared', () => {
    const r = pairItems(
      [row('TEST-0001', '8800000000001'), row('TEST-0002', '8800000000002')],
      core({ 'TEST-0001': 'skuA' }, { '8800000000002': ['skuA'] }),
    );
    expect(r.pairs).toEqual([]);
    expect(r.unpaired.map((u) => u.reason)).toEqual(['sku_shared', 'sku_shared']);
  });

  it('벗겨 저장된 core 바코드 키로 짝지어진다', () => {
    const r = pairItems([row('TEST-0001', '8800000000001')], core({}, { '8800000000001': ['skuA'] }));
    expect(r.pairs).toHaveLength(1);
  });

  it('사유가 여럿이면 앞 사유 하나만 적는다', () => {
    const r = pairItems([row('TEST-0001', '8800000000001'), row('TEST-0002', '8800000000001')], core({}, {}));
    expect(r.unpaired.map((u) => u.reason)).toEqual(['no_core_sku', 'no_core_sku']);
  });
});

describe('compareWithState', () => {
  const pair = (optionSerial: string, skuId: string): Pair => ({
    optionSerial,
    productSerial: 'P-1',
    name: 'TEST',
    barcode: '8800000000001',
    skuId,
    matchedBy: 'code',
  });
  const state = (optionSerial: string, skuId: string, frozen = false): StateRow => ({
    optionSerial,
    skuId,
    baseline: 1,
    carry: 0,
    frozen,
  });
  const none = new Set<string>();

  it('상태 있는 짝은 known, 없는 짝은 fresh', () => {
    const r = compareWithState([pair('A', 's1'), pair('B', 's2')], [state('A', 's1')], none);
    expect(r.known.map((p) => p.optionSerial)).toEqual(['A']);
    expect(r.fresh.map((p) => p.optionSerial)).toEqual(['B']);
  });

  it('상태가 있는데 짝도 excluded 도 아니면 missing', () => {
    const r = compareWithState([], [state('A', 's1')], none);
    expect(r.missing).toEqual([state('A', 's1')]);
    expect(r.toFreeze).toEqual([]);
  });

  it('같은 optionSerial 인데 skuId 가 다르면 skuChanged', () => {
    const r = compareWithState([pair('A', 's2')], [state('A', 's1')], none);
    expect(r.skuChanged).toEqual([{ pair: pair('A', 's2'), state: state('A', 's1') }]);
    expect(r.known).toEqual([]);
  });

  it('excluded 이고 frozen 이 아니면 toFreeze', () => {
    const r = compareWithState([], [state('A', 's1')], new Set(['A']));
    expect(r.toFreeze).toEqual([state('A', 's1')]);
    expect(r.missing).toEqual([]);
  });

  it('frozen 상태에 다시 짝이 나타나면 fresh', () => {
    const r = compareWithState([pair('A', 's2')], [state('A', 's1', true)], none);
    expect(r.fresh.map((p) => p.optionSerial)).toEqual(['A']);
    expect(r.skuChanged).toEqual([]);
  });

  it('frozen 상태는 missing·toFreeze 에 들지 않는다', () => {
    const r = compareWithState([], [state('A', 's1', true)], new Set(['A']));
    expect(r.missing).toEqual([]);
    expect(r.toFreeze).toEqual([]);
  });
});
