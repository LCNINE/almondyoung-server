import { inkInBarcodeKeepOuts } from '../../../platform/label/__support__/label-invariants';
import { fitModuleDots, renderLocationLabel, renderSkuLabel } from './label-templates';

describe('라벨 템플릿', () => {
  it('fitModuleDots: 30×10 에 11자리는 2 dot, 기준 3 dot 라벨에서도 넘치면 줄인다', () => {
    expect(fitModuleDots('11198120000', 28, 2)).toBe(2);
    expect(fitModuleDots('11198120000', 48, 3)).toBe(3);
    expect(fitModuleDots('A'.repeat(35), 28, 2)).toBeNull();
  });

  it.each(['30x10', '50x30'] as const)('SKU %s: 크기·바코드 값·금지 구역', (size) => {
    const r = renderSkuLabel(size, { name: '캐릭터 땅콩 브러쉬', barcode: '11198120000' });
    if (!r.ok) throw new Error(r.reason);
    expect([r.spec.widthMm, r.spec.heightMm]).toEqual(size === '30x10' ? [30, 10] : [50, 30]);
    expect(r.spec.barcodes).toEqual([expect.objectContaining({ kind: 'CODE128_OPTIMAL', data: '11198120000' })]);
    expect(inkInBarcodeKeepOuts(r.spec).every((z) => z.ink === 0)).toBe(true);
  });

  it('아주 긴 이름·괄호·이모지는 두 줄 말줄임이고 바코드 금지 구역 밖이다', () => {
    const name = '노몬드 속눈썹 펌제 10개입 [STEP 1 연화제] 아주 아주 긴 상품명 🎀 (리필) '.repeat(3);
    for (const size of ['30x10', '50x30'] as const) {
      const r = renderSkuLabel(size, { name, barcode: '10630920004' });
      if (!r.ok) throw new Error(r.reason);
      expect((r.spec.svg.match(/<text/g) ?? []).length).toBeLessThanOrEqual(size === '30x10' ? 2 : 3);
      expect(r.spec.svg).toContain('…');
      expect(inkInBarcodeKeepOuts(r.spec).every((z) => z.ink === 0)).toBe(true);
    }
  });

  it('사유', () => {
    expect(renderLocationLabel('M-07-꼭대기')).toEqual({ ok: false, reason: 'UNSUPPORTED_CODE' });
    expect(renderSkuLabel('30x10', { name: 'x', barcode: 'A'.repeat(35) })).toEqual({
      ok: false,
      reason: 'BARCODE_TOO_WIDE',
    });
    expect(renderSkuLabel('50x30', { name: 'x', barcode: 'A^B' })).toEqual({ ok: false, reason: 'UNSUPPORTED_CODE' });
  });

  it('로케이션 50×30: 값은 코드 그대로, 금지 구역 깨끗', () => {
    const r = renderLocationLabel('CC-04-01');
    if (!r.ok) throw new Error(r.reason);
    expect([r.spec.widthMm, r.spec.heightMm]).toEqual([50, 30]);
    expect(r.spec.barcodes[0]).toMatchObject({ data: 'CC-04-01', moduleDots: 3 });
    expect(inkInBarcodeKeepOuts(r.spec).every((z) => z.ink === 0)).toBe(true);
  });
});
