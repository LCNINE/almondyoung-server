import { isFormula, planFormulaBarcodes, unwrapFormula, type BarcodeRow } from './formula-barcodes-plan';

const row = (id: string, skuId: string, barcode: string, extra: Partial<BarcodeRow> = {}): BarcodeRow => ({
  id,
  skuId,
  barcode,
  isPrimary: false,
  packingUnit: null,
  ...extra,
});

describe('unwrapFormula', () => {
  it('엑셀 수식 꼴을 벗기고 나머지는 그대로 둔다', () => {
    expect(unwrapFormula('="10579820000"')).toBe('10579820000');
    expect(unwrapFormula('="  8801234 "')).toBe('8801234');
    expect(unwrapFormula('10579820000')).toBe('10579820000');
    expect(unwrapFormula('S0034064714977')).toBe('S0034064714977');
    expect(unwrapFormula('="abc')).toBe('="abc');
  });

  it('수식 꼴만 수식으로 본다', () => {
    expect(isFormula('="1"')).toBe(true);
    expect(isFormula('1')).toBe(false);
    expect(isFormula('=1')).toBe(false);
  });
});

describe('planFormulaBarcodes', () => {
  it('같은 SKU 에 정상 값이 있으면 수식 꼴 행을 지운다', () => {
    const plan = planFormulaBarcodes([row('f1', 'sku-1', '="100"')], [row('c1', 'sku-1', '100')]);

    expect(plan.deletes.map((r) => r.id)).toEqual(['f1']);
    expect(plan.updates).toEqual([]);
    expect(plan.carries).toEqual([]);
  });

  it('정상 값이 없으면 벗긴 값으로 고친다', () => {
    const plan = planFormulaBarcodes([row('f1', 'sku-1', '="100"')], []);

    expect(plan.updates).toEqual([{ row: row('f1', 'sku-1', '="100"'), to: '100' }]);
    expect(plan.deletes).toEqual([]);
  });

  it('지우는 행이 대표였고 정상 행이 대표가 아니면 대표를 넘긴다', () => {
    const plan = planFormulaBarcodes(
      [row('f1', 'sku-1', '="100"', { isPrimary: true, packingUnit: 12 })],
      [row('c1', 'sku-1', '100')]
    );

    expect(plan.carries).toEqual([{ to: row('c1', 'sku-1', '100'), isPrimary: true, packingUnit: 12 }]);
  });

  it('정상 행이 이미 대표·상자 수량을 가졌으면 넘기지 않는다', () => {
    const plan = planFormulaBarcodes(
      [row('f1', 'sku-1', '="100"', { isPrimary: true, packingUnit: 12 })],
      [row('c1', 'sku-1', '100', { isPrimary: true, packingUnit: 6 })]
    );

    expect(plan.carries).toEqual([]);
  });

  it('벗긴 값을 다른 SKU 가 쓰고 있으면 손대지 않는다', () => {
    const plan = planFormulaBarcodes([row('f1', 'sku-1', '="100"')], [row('c1', 'sku-2', '100')]);

    expect(plan.conflicts).toEqual([{ row: row('f1', 'sku-1', '="100"'), ownerSkuId: 'sku-2' }]);
    expect(plan.deletes).toEqual([]);
    expect(plan.updates).toEqual([]);
  });

  it('수식 꼴끼리 같은 값으로 벗겨지면 같은 SKU 는 하나만 고치고, 다른 SKU 는 충돌로 둔다', () => {
    const plan = planFormulaBarcodes(
      [row('f1', 'sku-1', '="100"'), row('f2', 'sku-1', '="100 "'), row('f3', 'sku-2', '="100"')],
      []
    );

    expect(plan.updates.map((u) => u.row.id)).toEqual(['f1']);
    expect(plan.deletes.map((r) => r.id)).toEqual(['f2']);
    expect(plan.conflicts.map((c) => c.row.id)).toEqual(['f3']);
  });

  it('벗기면 빈 값이면 따로 모은다', () => {
    const plan = planFormulaBarcodes([row('f1', 'sku-1', '=""')], []);

    expect(plan.empties.map((r) => r.id)).toEqual(['f1']);
  });
});
