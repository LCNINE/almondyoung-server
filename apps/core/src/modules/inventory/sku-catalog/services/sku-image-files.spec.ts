import { pickSkuImageFileIds } from './sku-image-files';

describe('pickSkuImageFileIds', () => {
  it('puts the primary SKU image first, then the rest by sort order', () => {
    const result = pickSkuImageFileIds(
      ['sku-1'],
      [
        { ownerId: 'sku-1', fileId: 'b', isPrimary: false, sortOrder: 2 },
        { ownerId: 'sku-1', fileId: 'a', isPrimary: false, sortOrder: 1 },
        { ownerId: 'sku-1', fileId: 'main', isPrimary: true, sortOrder: 5 },
      ],
      new Map(),
      [],
    );

    expect(result.get('sku-1')).toEqual(['main', 'a', 'b']);
  });

  it('falls back to the matched product images only when the SKU has none', () => {
    const result = pickSkuImageFileIds(
      ['own', 'fallback'],
      [{ ownerId: 'own', fileId: 'own-1', isPrimary: true, sortOrder: 0 }],
      new Map([
        ['own', 'version-a'],
        ['fallback', 'version-a'],
      ]),
      [
        { ownerId: 'version-a', fileId: 'extra', isPrimary: false, sortOrder: 1 },
        { ownerId: 'version-a', fileId: 'product-main', isPrimary: true, sortOrder: 0 },
      ],
    );

    expect(result.get('own')).toEqual(['own-1']);
    expect(result.get('fallback')).toEqual(['product-main', 'extra']);
  });

  it('returns an empty list for a SKU with no image anywhere', () => {
    const result = pickSkuImageFileIds(['none'], [], new Map(), []);

    expect(result.get('none')).toEqual([]);
  });
});
