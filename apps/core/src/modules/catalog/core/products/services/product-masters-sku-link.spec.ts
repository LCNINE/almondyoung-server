import { summarizeSkuLinks } from './product-masters-sku-link';

describe('summarizeSkuLinks', () => {
  it('품목별 상태와 버전별 연결 안 된 품목 수를 만든다 — 재고 안 씀은 세지 않는다', () => {
    const { byVariant, unlinkedCountByVersion } = summarizeSkuLinks([
      { versionId: 'v1', variantId: 'a', state: 'linked', skuCount: 2 },
      { versionId: 'v1', variantId: 'b', state: 'unlinked', skuCount: 0 },
      { versionId: 'v1', variantId: 'c', state: 'void', skuCount: 0 },
      { versionId: 'v2', variantId: 'd', state: 'unlinked', skuCount: 0 },
      { versionId: 'v2', variantId: 'e', state: 'unlinked', skuCount: 0 },
      { versionId: 'v3', variantId: 'f', state: 'linked', skuCount: 1 },
    ]);

    expect(byVariant.get('a')).toEqual({ state: 'linked', skuCount: 2 });
    expect(byVariant.get('c')).toEqual({ state: 'void', skuCount: 0 });
    expect(unlinkedCountByVersion.get('v1')).toBe(1);
    expect(unlinkedCountByVersion.get('v2')).toBe(2);
    expect(unlinkedCountByVersion.has('v3')).toBe(false);
  });

  it('링크가 남은 비매칭 품목은 SKU 수를 0 으로 본다', () => {
    const { byVariant } = summarizeSkuLinks([{ versionId: 'v1', variantId: 'a', state: 'void', skuCount: 3 }]);

    expect(byVariant.get('a')?.skuCount).toBe(0);
  });
});
