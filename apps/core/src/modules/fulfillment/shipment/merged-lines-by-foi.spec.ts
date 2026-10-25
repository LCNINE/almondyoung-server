import { FoiSkuMismatchError, mergedLinesByFoi, MergeableLine } from './merged-lines-by-foi';

const line = (over: Partial<MergeableLine> & { id: string }): MergeableLine => ({
  fulfillmentOrderItemId: 'f1',
  skuId: 's1',
  qty: 1,
  createdAt: new Date('2026-10-02T00:00:00Z'),
  demandRequestedAt: null,
  ...over,
});

describe('mergedLinesByFoi', () => {
  it('FOI 당 하나로 합치고 수량 합·가장 이른 시각을 쓴다', () => {
    const [m] = mergedLinesByFoi([
      line({ id: 'a', qty: 2, demandRequestedAt: new Date('2026-10-01T00:00:00Z') }),
      line({ id: 'b', qty: 3, createdAt: new Date('2026-10-03T00:00:00Z') }),
    ]);
    expect(m.sourceLines.map((l) => l.id)).toEqual(['a', 'b']);
    expect(m.newLine.qty).toBe(5);
    expect(m.newLine.createdFromLineId).toBeNull();
    expect(m.newLine.createdAt?.toISOString()).toBe('2026-10-02T00:00:00.000Z');
    expect(m.newLine.demandRequestedAt?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });
  it('원천이 하나면 createdFromLineId, FOI id 순으로 낸다', () => {
    const out = mergedLinesByFoi([
      line({ id: 'x', fulfillmentOrderItemId: 'f2' }),
      line({ id: 'y', fulfillmentOrderItemId: 'f1' }),
    ]);
    expect(out.map((m) => m.fulfillmentOrderItemId)).toEqual(['f1', 'f2']);
    expect(out[0].newLine.createdFromLineId).toBe('y');
  });
  it('한 FOI 에 SKU 가 둘이면 FoiSkuMismatchError', () => {
    expect(() => mergedLinesByFoi([line({ id: 'a' }), line({ id: 'b', skuId: 's2' })])).toThrow(FoiSkuMismatchError);
  });
});
