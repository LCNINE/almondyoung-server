import { boxTarget, diffBox, unitsOfLineInBox } from './box-target';

const view = (shipmentLineId: string, salesOrderLineId: string | null, skuId: string, qty: number) => ({
  shipmentLineId,
  salesOrderLineId,
  skuId,
  qty,
});

describe('boxTarget', () => {
  it('라인별 담긴 개수 × 1개당 수량, 0 은 빼고 범위는 넘긴 라인 전부', () => {
    expect(
      boxTarget(
        new Map([
          ['L2', 0],
          ['L1', 2],
        ]),
        new Map([
          [
            'L1',
            [
              { skuId: 'b', qtyPerUnit: 1 },
              { skuId: 'a', qtyPerUnit: 3 },
            ],
          ],
          ['L2', [{ skuId: 'c', qtyPerUnit: 1 }]],
        ]),
      ),
    ).toEqual({
      salesOrderLineIds: ['L1', 'L2'],
      items: [
        { salesOrderLineId: 'L1', skuId: 'a', qty: 6 },
        { salesOrderLineId: 'L1', skuId: 'b', qty: 2 },
      ],
    });
  });
});

describe('unitsOfLineInBox', () => {
  const composition = [
    { skuId: 'a', qtyPerUnit: 2 },
    { skuId: 'b', qtyPerUnit: 1 },
  ];
  it('SKU 마다 같은 개수가 나오면 그 값, 라인이 없으면 0', () => {
    expect(
      unitsOfLineInBox(
        'L1',
        [view('s1', 'L1', 'a', 4), view('s2', 'L1', 'b', 2), view('s3', 'L9', 'a', 7)],
        composition,
      ),
    ).toBe(2);
    expect(unitsOfLineInBox('L1', [view('s3', 'L9', 'a', 7)], composition)).toBe(0);
  });
  it('SKU 별로 다른 박스에 갈라졌거나 나눠떨어지지 않거나 구성 밖 SKU 가 있으면 COMPOSITION_UNITS_AMBIGUOUS', () => {
    for (const lines of [
      [view('s1', 'L1', 'a', 4)],
      [view('s1', 'L1', 'a', 3), view('s2', 'L1', 'b', 2)],
      [view('s1', 'L1', 'a', 4), view('s2', 'L1', 'b', 2), view('s4', 'L1', 'z', 1)],
    ]) {
      expect(() => unitsOfLineInBox('L1', lines, composition)).toThrow(
        expect.objectContaining({ response: expect.objectContaining({ code: 'COMPOSITION_UNITS_AMBIGUOUS' }) }),
      );
    }
  });
});

describe('diffBox', () => {
  it('범위 밖 라인(합포장의 다른 주문)은 건드리지 않는다', () => {
    const diff = diffBox([view('s1', 'L1', 'a', 2), view('s9', 'OTHER', 'a', 5)], {
      salesOrderLineIds: ['L1'],
      items: [{ salesOrderLineId: 'L1', skuId: 'a', qty: 2 }],
    });
    expect(diff).toEqual({ decreases: [], increases: [] });
  });

  it('SKU 교체: 옛 줄은 통째로 줄이고 새 (라인, SKU) 는 줄 없이 늘린다', () => {
    expect(
      diffBox([view('s1', 'L1', 'a', 2)], {
        salesOrderLineIds: ['L1'],
        items: [{ salesOrderLineId: 'L1', skuId: 'b', qty: 4 }],
      }),
    ).toEqual({
      decreases: [{ shipmentLineId: 's1', qty: 2 }],
      increases: [{ salesOrderLineId: 'L1', skuId: 'b', qty: 4, shipmentLineId: null }],
    });
  });

  it('같은 (라인, SKU) 의 증감은 첫 줄에서 — 감소는 줄 id 순으로 나눠 뺀다', () => {
    expect(
      diffBox([view('s2', 'L1', 'a', 1), view('s1', 'L1', 'a', 2)], {
        salesOrderLineIds: ['L1'],
        items: [{ salesOrderLineId: 'L1', skuId: 'a', qty: 5 }],
      }),
    ).toEqual({ decreases: [], increases: [{ salesOrderLineId: 'L1', skuId: 'a', qty: 2, shipmentLineId: 's1' }] });
    expect(
      diffBox([view('s2', 'L1', 'a', 1), view('s1', 'L1', 'a', 2)], {
        salesOrderLineIds: ['L1'],
        items: [],
      }),
    ).toEqual({
      decreases: [
        { shipmentLineId: 's1', qty: 2 },
        { shipmentLineId: 's2', qty: 1 },
      ],
      increases: [],
    });
  });

  it('목표가 범위 밖 라인을 가리키거나 같은 (라인, SKU) 가 두 번이면 던진다(호출자 결함)', () => {
    expect(() =>
      diffBox([], { salesOrderLineIds: ['L1'], items: [{ salesOrderLineId: 'L2', skuId: 'a', qty: 1 }] }),
    ).toThrow(/outside/);
    expect(() =>
      diffBox([], {
        salesOrderLineIds: ['L1'],
        items: [
          { salesOrderLineId: 'L1', skuId: 'a', qty: 1 },
          { salesOrderLineId: 'L1', skuId: 'a', qty: 2 },
        ],
      }),
    ).toThrow(/duplicate/);
  });
});
