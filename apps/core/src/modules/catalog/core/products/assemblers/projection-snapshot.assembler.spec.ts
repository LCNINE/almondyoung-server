import { BadRequestException } from '@nestjs/common';
import { ProjectionSnapshotAssembler } from './projection-snapshot.assembler';

type CategoryFixture = {
  id: string;
  name: string;
  slug: string;
  path: string;
  parentId: string | null;
  isActive: boolean;
  visibility: boolean;
  showOnMainCategory: boolean;
  thumbnailFileId: string | null;
  isPrimary: boolean;
};

type VariantFixture = {
  id: string;
  variantName?: string | null;
  variantCode?: string | null;
  isDefault?: boolean;
  status?: string;
  optionValueIds?: string[];
};

type AssemblerFixtures = {
  version?: Record<string, unknown>;
  categories?: CategoryFixture[];
  variants?: VariantFixture[];
  images?: Array<Record<string, unknown>>;
  tags?: Array<Record<string, unknown>>;
  purchaseConstraint?: Record<string, unknown> | null;
  prices?: Array<Record<string, unknown>>;
  optionGroups?: Array<
    Record<string, unknown> & { id: string; values: Array<Record<string, unknown> & { id: string }> }
  >;
  variantOptionValuesByVariant?: Record<string, Array<Record<string, unknown>>>;
};

const category = (overrides: Partial<CategoryFixture> & Pick<CategoryFixture, 'id'>): CategoryFixture => ({
  id: overrides.id,
  name: 'Lip',
  slug: 'lip',
  path: '/makeup/lip',
  parentId: 'cat-makeup',
  isActive: true,
  visibility: true,
  showOnMainCategory: false,
  thumbnailFileId: null,
  isPrimary: false,
  ...overrides,
});

function makeAssembler(fixtures: AssemblerFixtures = {}) {
  const version = {
    id: 'version-1',
    masterId: 'master-1',
    version: 3,
    status: 'active',
    name: 'Lip Tint',
    description: null,
    descriptionHtml: null,
    seoTitle: null,
    seoDescription: null,
    seoKeywords: null,
    brand: null,
    productType: 'regular_sale',
    fulfillmentKind: 'physical',
    isWholesaleOnly: false,
    hideMembershipPriceForNonMembers: false,
    isMembershipOnly: false,
    isVisibleToMembersOnly: false,
    ...fixtures.version,
  };
  const categories = fixtures.categories ?? [
    category({
      id: 'cat-lip',
      name: 'Lip',
      slug: 'lip',
      path: '/makeup/lip',
      isPrimary: true,
      showOnMainCategory: true,
      thumbnailFileId: 'file-category',
    }),
  ];
  const variants = fixtures.variants ?? [
    {
      id: 'variant-1',
      variantName: 'Default',
      variantCode: null,
      isDefault: true,
      status: 'active',
      optionValueIds: [],
    },
  ];
  const images = fixtures.images ?? [];
  const tags = fixtures.tags ?? [];
  const purchaseConstraint = fixtures.purchaseConstraint ?? null;
  const prices =
    fixtures.prices ??
    variants
      .filter((variant) => variant.status === 'active')
      .map((variant) => ({
        variantId: variant.id,
        basePrice: 10000,
        membershipPrice: 9000,
        tieredPrices: [],
      }));
  const optionGroups = fixtures.optionGroups ?? [];
  const variantOptionValuesByVariant = fixtures.variantOptionValuesByVariant ?? {};

  const versionReadLoader = {
    getVersionById: jest.fn().mockResolvedValue(version),
    getCategories: jest.fn().mockResolvedValue(categories),
    getVariants: jest.fn().mockResolvedValue(variants),
    getImages: jest.fn().mockResolvedValue(images),
    getPurchaseConstraint: jest.fn().mockResolvedValue(purchaseConstraint),
  };
  const optionReadLoader = {
    getOptionGroups: jest.fn().mockResolvedValue(optionGroups),
    getVariantOptionValues: jest.fn((_tx, variantId: string) =>
      Promise.resolve(variantOptionValuesByVariant[variantId] ?? []),
    ),
  };
  const tagReadLoader = { getTags: jest.fn().mockResolvedValue(tags) };
  const priceCacheService = { getCachedPriceSetsByVersion: jest.fn().mockResolvedValue(prices) };

  return {
    assembler: new ProjectionSnapshotAssembler(
      versionReadLoader as any,
      optionReadLoader as any,
      tagReadLoader as any,
      priceCacheService as any,
    ),
    optionReadLoader,
  };
}

describe('ProjectionSnapshotAssembler', () => {
  it('fails when the version is not DB-visible active', async () => {
    const { assembler } = makeAssembler({ version: { status: 'draft' } });

    await expect(assembler.assembleActiveVersionSnapshot('master-1', 'version-1', {} as any)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('fails when an active version has no active variants', async () => {
    const { assembler } = makeAssembler({
      variants: [{ id: 'variant-1', status: 'inactive', optionValueIds: [] }],
    });

    await expect(assembler.assembleActiveVersionSnapshot('master-1', 'version-1', {} as any)).rejects.toThrow(
      'requires at least one active variant',
    );
  });

  it('fails when an active variant has no calculated price cache row', async () => {
    const { assembler } = makeAssembler({ prices: [] });

    await expect(assembler.assembleActiveVersionSnapshot('master-1', 'version-1', {} as any)).rejects.toThrow(
      'Missing calculated price cache',
    );
  });

  it('fails when active variant option display rows are missing for ko-KR', async () => {
    const { assembler } = makeAssembler({
      variants: [{ id: 'variant-1', status: 'active', isDefault: false, optionValueIds: ['value-red'] }],
      variantOptionValuesByVariant: { 'variant-1': [] },
    });

    await expect(assembler.assembleActiveVersionSnapshot('master-1', 'version-1', {} as any)).rejects.toThrow(
      'Missing option display',
    );
  });

  it('assembles active variants only and keeps thumbnail/images as File UUID values', async () => {
    const { assembler } = makeAssembler({
      categories: [
        category({
          id: 'cat-lip',
          isPrimary: true,
          isActive: true,
          visibility: true,
          showOnMainCategory: true,
          thumbnailFileId: 'file-category',
        }),
      ],
      variants: [
        { id: 'variant-active', status: 'active', variantName: 'Red', isDefault: true, optionValueIds: [] },
        { id: 'variant-inactive', status: 'inactive', variantName: 'Blue', isDefault: false, optionValueIds: [] },
      ],
      images: [
        { id: 'image-1', fileId: 'file-primary', isPrimary: true, sortOrder: 1 },
        { id: 'image-2', fileId: 'file-secondary', isPrimary: false, sortOrder: 2 },
      ],
    });

    const assembly = await assembler.assembleActiveVersionSnapshot('master-1', 'version-1', {} as any);

    expect(assembly.categoryIds).toEqual(['cat-lip']);
    expect(assembly.primaryCategoryId).toBe('cat-lip');
    expect(assembly.snapshot.status).toBe('active');
    expect(assembly.snapshot.thumbnail).toBe('file-primary');
    expect(assembly.snapshot.images).toEqual([
      { fileId: 'file-primary', url: 'file-primary', isPrimary: true, sortOrder: 1 },
      { fileId: 'file-secondary', url: 'file-secondary', isPrimary: false, sortOrder: 2 },
    ]);
    expect(assembly.snapshot.categories).toEqual([
      {
        id: 'cat-lip',
        name: 'Lip',
        slug: 'lip',
        path: '/makeup/lip',
        parentId: 'cat-makeup',
        isActive: true,
        visibility: true,
        showOnMainCategory: true,
        thumbnail: 'file-category',
      },
    ]);
    expect(assembly.snapshot.variants.map((variant) => variant.id)).toEqual(['variant-active']);
    expect(assembly.snapshot.variants[0]).toEqual(
      expect.objectContaining({
        status: 'active',
        basePrice: 10000,
        membershipPrice: 9000,
        tieredPrices: [],
      }),
    );
  });

  it('keeps optionless products optionless', async () => {
    const { assembler, optionReadLoader } = makeAssembler({
      variants: [
        { id: 'variant-default', status: 'active', variantName: 'Default', isDefault: true, optionValueIds: [] },
      ],
      optionGroups: [
        {
          id: 'group-unused',
          displayName: 'Unused',
          values: [{ id: 'value-unused', displayName: 'Unused' }],
        },
      ],
    });

    const assembly = await assembler.assembleActiveVersionSnapshot('master-1', 'version-1', {} as any);

    expect(assembly.snapshot.optionGroups).toEqual([]);
    expect(assembly.snapshot.variants[0].optionCombination).toEqual([]);
    expect(optionReadLoader.getVariantOptionValues).not.toHaveBeenCalled();
  });

  it('emits only option groups and values used by active variants', async () => {
    const { assembler } = makeAssembler({
      variants: [
        { id: 'variant-red', status: 'active', variantName: 'Red', isDefault: false, optionValueIds: ['value-red'] },
        {
          id: 'variant-blue-inactive',
          status: 'inactive',
          variantName: 'Blue',
          isDefault: false,
          optionValueIds: ['value-blue'],
        },
      ],
      optionGroups: [
        {
          id: 'group-color',
          displayName: 'Color',
          values: [
            { id: 'value-red', displayName: 'Red' },
            { id: 'value-blue', displayName: 'Blue' },
            { id: 'value-green', displayName: 'Green' },
          ],
        },
        {
          id: 'group-size',
          displayName: 'Size',
          values: [{ id: 'value-large', displayName: 'Large' }],
        },
      ],
      variantOptionValuesByVariant: {
        'variant-red': [
          {
            id: 'value-red',
            optionGroupId: 'group-color',
            optionGroupName: 'Color',
            displayName: 'Red',
          },
        ],
      },
    });

    const assembly = await assembler.assembleActiveVersionSnapshot('master-1', 'version-1', {} as any);

    expect(assembly.snapshot.optionGroups).toEqual([
      {
        id: 'group-color',
        name: 'Color',
        values: [{ id: 'value-red', name: 'Red' }],
      },
    ]);
    expect(assembly.snapshot.variants).toEqual([
      expect.objectContaining({
        id: 'variant-red',
        optionCombination: [{ name: 'Color', value: 'Red' }],
      }),
    ]);
  });

  it('fails when more than one category is marked primary', async () => {
    const { assembler } = makeAssembler({
      categories: [category({ id: 'cat-1', isPrimary: true }), category({ id: 'cat-2', isPrimary: true })],
    });

    await expect(assembler.assembleActiveVersionSnapshot('master-1', 'version-1', {} as any)).rejects.toThrow(
      'Multiple primary categories',
    );
  });
});
