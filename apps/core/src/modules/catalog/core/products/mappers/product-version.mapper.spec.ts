import { ProductVersionMapper } from './product-version.mapper';

describe('ProductVersionMapper', () => {
  it('includes both canonical markdown and legacy html descriptions', () => {
    const response = ProductVersionMapper.toDetailResponseDto({
      id: 'version-1',
      masterId: 'master-1',
      version: 2,
      status: 'draft',
      name: '상품',
      description: '# Markdown',
      descriptionHtml: '<img src="legacy.jpg" />',
      brand: null,
      thumbnail: null,
      seoTitle: null,
      seoDescription: null,
      seoKeywords: null,
      isWholesaleOnly: false,
      isMembershipOnly: false,
      productType: null,
      fulfillmentKind: 'physical',
      productCode: null,
      alternativeName: null,
      material: null,
      salesClassification: null,
      purchaseClassification: null,
      shippingMethodId: null,
      marketPrice: null,
      supplyPrice: null,
      supplierId: null,
      ageRestriction: null,
      minQuantity: null,
      maxQuantity: null,
      salesStartDate: null,
      salesEndDate: null,
      parentVersionId: null,
      draftOwnerId: 'user-1',
      createdAt: new Date('2026-06-05T00:00:00.000Z'),
      updatedAt: new Date('2026-06-05T00:00:00.000Z'),
      images: [],
      categories: [
        {
          id: 'cat-1',
          name: '스킨케어',
          slug: 'skin-care',
          path: 'beauty/skin-care',
          parentId: null,
          isActive: true,
          isPrimary: true,
        },
      ],
      optionGroups: [],
      variants: [],
      channelProducts: [],
      purchaseConstraint: {
        id: 'constraint-1',
        requiresMembership: true,
        lifetimeQuantityLimit: 3,
      },
    } as any);

    expect(response.description).toBe('# Markdown');
    expect(response.descriptionHtml).toBe('<img src="legacy.jpg" />');
    expect(response.fulfillmentKind).toBe('physical');
    expect(response.categories).toEqual([
      {
        id: 'cat-1',
        name: '스킨케어',
        slug: 'skin-care',
        path: 'beauty/skin-care',
        parentId: null,
        isActive: true,
        isPrimary: true,
      },
    ]);
    expect(response.purchaseConstraint).toEqual({
      id: 'constraint-1',
      requiresMembership: true,
      lifetimeQuantityLimit: 3,
    });
  });
});
