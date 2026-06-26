import { ProductReadAssembler } from './product-read.assembler';

describe('ProductReadAssembler shared loader integration', () => {
  it('preserves admin version detail shape while reading fragments from ProductVersionReadLoader', async () => {
    const versionLoader = {
      getVersionById: jest.fn().mockResolvedValue({
        id: 'version-1',
        masterId: 'master-1',
        version: 1,
        status: 'active',
        name: 'Tint',
      }),
      getVariants: jest.fn().mockResolvedValue([
        {
          id: 'variant-1',
          variantName: 'Red',
          status: 'active',
          isDefault: true,
          optionValueIds: [],
        },
      ]),
      getImages: jest.fn().mockResolvedValue([
        { id: 'image-1', versionId: 'version-1', fileId: 'file-primary', isPrimary: true, sortOrder: 1 },
      ]),
      getCategories: jest.fn().mockResolvedValue([
        {
          id: 'category-1',
          name: 'Lip',
          slug: 'lip',
          path: '/lip',
          parentId: null,
          isActive: true,
          visibility: true,
          showOnMainCategory: false,
          thumbnailFileId: null,
          isPrimary: true,
        },
      ]),
      getPurchaseConstraint: jest.fn().mockResolvedValue({
        id: 'constraint-1',
        requiresMembership: true,
        lifetimeQuantityLimit: 3,
      }),
    };
    const priceCacheService = {
      getCachedPriceSetsByVersion: jest.fn().mockResolvedValue([
        { variantId: 'variant-1', basePrice: 10000, membershipPrice: 9000, tieredPrices: [] },
      ]),
      getPriceSummariesByVersionIds: jest.fn().mockResolvedValue(new Map([['version-1', { minBasePrice: 10000 }]])),
    };
    const optionReadLoader = {
      getOptionGroups: jest.fn().mockResolvedValue([]),
      getVariantOptionValues: jest.fn().mockResolvedValue([]),
    };
    const tagReadLoader = { getTags: jest.fn().mockResolvedValue([]) };
    const assembler = new ProductReadAssembler(
      { db: { transaction: jest.fn() } } as any,
      priceCacheService as any,
      optionReadLoader as any,
      tagReadLoader as any,
      versionLoader as any,
    );

    const detail = await assembler.getVersionDetail('version-1', undefined, {} as any);

    expect(versionLoader.getVersionById).toHaveBeenCalledWith({}, 'version-1');
    expect(versionLoader.getVariants).toHaveBeenCalledWith({}, 'master-1', 'version-1');
    expect(versionLoader.getImages).toHaveBeenCalledWith({}, 'version-1');
    expect(versionLoader.getCategories).toHaveBeenCalledWith({}, 'master-1', 'version-1');
    expect(versionLoader.getPurchaseConstraint).toHaveBeenCalledWith({}, 'master-1', 'version-1');
    expect(detail.thumbnail).toBe('file-primary');
    expect(detail.categories).toEqual([
      { id: 'category-1', name: 'Lip', slug: 'lip', path: '/lip', parentId: null, isActive: true, isPrimary: true },
    ]);
    expect(detail.variants[0]).toEqual(
      expect.objectContaining({
        id: 'variant-1',
        price: 10000,
        priceSet: { basePrice: 10000, membershipPrice: 9000, tieredPrices: [] },
      }),
    );
    expect(detail.variants[0]).not.toHaveProperty('optionValueIds');
    expect(detail.channelProducts).toEqual([]);
    expect(detail.tagValues).toEqual([]);
    expect(detail.priceSummary).toEqual({ minBasePrice: 10000 });
    expect(detail.purchaseConstraint).toEqual({
      id: 'constraint-1',
      requiresMembership: true,
      lifetimeQuantityLimit: 3,
    });
  });
});
