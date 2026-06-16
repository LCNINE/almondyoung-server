import {
  canEditBasicInformation,
  flattenCategoryTree,
  formatSelectedCategories,
  toBasicInformationFormValues,
  toBasicInformationUpdateDto,
} from './basic-information-model';

describe('basic information editing model', () => {
  const detail = {
    source: 'version' as const,
    versionId: 'ver-draft',
    status: 'draft' as const,
    name: 'Draft Product',
    brand: 'Almond',
    seoTitle: 'SEO title',
    seoDescription: 'SEO description',
    seoKeywords: ['almond', 'young'],
    isWholesaleOnly: true,
    hideMembershipPriceForNonMembers: null,
    isVisibleToMembersOnly: false,
    isMembershipOnly: null,
    fulfillmentKind: null,
    categories: [
      {
        id: 'cat-primary',
        name: 'Cream',
        slug: 'cream',
        path: 'cat-root/cat-primary',
        parentId: 'cat-parent',
        isActive: true,
        isPrimary: true,
      },
      {
        id: 'cat-secondary',
        name: 'Serum',
        slug: 'serum',
        path: 'cat-root/cat-secondary',
        parentId: 'cat-parent',
        isActive: true,
        isPrimary: false,
      },
    ],
  };

  it('allows editing only for draft version detail views', () => {
    expect(
      canEditBasicInformation({
        ...detail,
      })
    ).toBe(true);

    expect(
      canEditBasicInformation({
        ...detail,
        source: 'master',
        versionId: null,
        status: 'active',
      })
    ).toBe(false);

    expect(
      canEditBasicInformation({
        ...detail,
        source: 'version',
        versionId: 'ver-active',
        status: 'active',
      })
    ).toBe(false);

    expect(
      canEditBasicInformation({
        ...detail,
        source: 'version',
        versionId: 'ver-inactive',
        status: 'inactive',
      })
    ).toBe(false);
  });

  it('normalizes draft detail values for the edit form', () => {
    expect(toBasicInformationFormValues(detail)).toEqual({
      name: 'Draft Product',
      brand: 'Almond',
      seoTitle: 'SEO title',
      seoDescription: 'SEO description',
      seoKeywordsText: 'almond, young',
      isWholesaleOnly: true,
      hideMembershipPriceForNonMembers: false,
      isVisibleToMembersOnly: false,
      fulfillmentKind: 'physical',
      categoryIds: ['cat-primary', 'cat-secondary'],
      primaryCategoryId: 'cat-primary',
    });
  });

  it('builds a trimmed version update payload with SEO and category fields', () => {
    expect(
      toBasicInformationUpdateDto({
        name: '  Edited Product  ',
        brand: '  Almond Young  ',
        seoTitle: '  Custom SEO title  ',
        seoDescription: '  Custom SEO description  ',
        seoKeywordsText: ' glow, skincare\n glow, serum ',
        isWholesaleOnly: true,
        hideMembershipPriceForNonMembers: false,
        isVisibleToMembersOnly: true,
        fulfillmentKind: 'physical',
        categoryIds: ['cat-secondary', 'cat-primary'],
        primaryCategoryId: 'cat-primary',
      })
    ).toEqual({
      name: 'Edited Product',
      brand: 'Almond Young',
      seoTitle: 'Custom SEO title',
      seoDescription: 'Custom SEO description',
      seoKeywords: ['glow', 'skincare', 'serum'],
      isWholesaleOnly: true,
      hideMembershipPriceForNonMembers: false,
      isMembershipOnly: false,
      isVisibleToMembersOnly: true,
      fulfillmentKind: 'physical',
      categoryIds: ['cat-secondary', 'cat-primary'],
      primaryCategoryId: 'cat-primary',
    });

    expect(
      toBasicInformationUpdateDto({
        name: 'Edited Product',
        brand: '   ',
        seoTitle: '   ',
        seoDescription: '   ',
        seoKeywordsText: ' ,  ',
        isWholesaleOnly: false,
        hideMembershipPriceForNonMembers: true,
        isVisibleToMembersOnly: false,
        fulfillmentKind: 'digital',
        categoryIds: [],
        primaryCategoryId: 'cat-not-selected',
      })
    ).toMatchObject({
      brand: null,
      seoTitle: null,
      seoDescription: null,
      seoKeywords: [],
      isWholesaleOnly: false,
      hideMembershipPriceForNonMembers: true,
      isMembershipOnly: true,
      isVisibleToMembersOnly: false,
      fulfillmentKind: 'digital',
      categoryIds: [],
      primaryCategoryId: null,
    });
  });

  it('formats selected category names for display without exposing raw path ids', () => {
    expect(formatSelectedCategories(detail.categories)).toBe('Cream, Serum');
    expect(formatSelectedCategories([])).toBe('-');
  });

  it('flattens a nested category tree with searchable path labels', () => {
    expect(
      flattenCategoryTree([
        {
          id: 'cat-root',
          name: 'Beauty',
          slug: 'beauty',
          parentId: null,
          isActive: true,
          children: [
            {
              id: 'cat-child',
              name: 'Skin Care',
              slug: 'skin-care',
              parentId: 'cat-root',
              isActive: true,
              children: [
                {
                  id: 'cat-leaf',
                  name: 'Cream',
                  slug: 'cream',
                  parentId: 'cat-child',
                  isActive: false,
                },
              ],
            },
          ],
        },
      ])
    ).toEqual([
      {
        id: 'cat-root',
        name: 'Beauty',
        slug: 'beauty',
        pathLabel: 'Beauty',
        depth: 0,
        parentId: null,
        isActive: true,
      },
      {
        id: 'cat-child',
        name: 'Skin Care',
        slug: 'skin-care',
        pathLabel: 'Beauty / Skin Care',
        depth: 1,
        parentId: 'cat-root',
        isActive: true,
      },
      {
        id: 'cat-leaf',
        name: 'Cream',
        slug: 'cream',
        pathLabel: 'Beauty / Skin Care / Cream',
        depth: 2,
        parentId: 'cat-child',
        isActive: false,
      },
    ]);
  });
});
