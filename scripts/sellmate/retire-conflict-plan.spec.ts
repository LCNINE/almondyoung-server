import { Holder, planRetire } from './retire-conflict-plan';

const holder = (over: Partial<Holder>): Holder => ({
  skuId: 'old',
  code: '100',
  name: '예전 품목',
  barcode: 'B1',
  isPrimary: true,
  barcodeCount: 1,
  onHandBucheon: 25,
  onHandElsewhere: 0,
  openReservations: 0,
  ...over,
});

describe('planRetire', () => {
  it('짝이 없는 보유자는 재고 0 + 바코드 떼기, 짝이 있는 보유자는 바코드만 뗀다', () => {
    const plan = planRetire(
      [
        { optionSerial: '1', itemName: '현재 A', barcode: 'B1' },
        { optionSerial: '2', itemName: '세트', barcode: 'B2' },
        { optionSerial: '3', itemName: '이미 풀림', barcode: 'B3' },
      ],
      new Map([
        ['B1', holder({})],
        ['B2', holder({ skuId: 'cur', code: '200', barcode: 'B2', isPrimary: false, barcodeCount: 2 })],
      ]),
      new Set(['cur']),
    );

    expect(plan.rows.map((r) => [r.holder.code, r.kind, r.take])).toEqual([
      ['100', 'retire', 25],
      ['200', 'unbarcode', 0],
    ]);
    expect(plan.noHolder.map((c) => c.barcode)).toEqual(['B3']);
    expect(plan.blockers).toEqual([]);
  });

  it('예약이 열렸거나 부천 밖 재고가 있거나 대표 바코드를 떼면 거절 사유를 낸다', () => {
    const plan = planRetire(
      [
        { optionSerial: '1', itemName: 'x', barcode: 'B1' },
        { optionSerial: '2', itemName: 'y', barcode: 'B2' },
      ],
      new Map([
        ['B1', holder({ openReservations: 1, onHandElsewhere: 3 })],
        ['B2', holder({ skuId: 'cur', code: '200', barcode: 'B2', isPrimary: true, barcodeCount: 2 })],
      ]),
      new Set(['cur']),
    );

    expect(plan.blockers).toHaveLength(3);
  });
});
