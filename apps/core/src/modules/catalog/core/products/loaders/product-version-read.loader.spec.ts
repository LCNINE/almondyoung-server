import { ProductVersionReadLoader } from './product-version-read.loader';
import {
  productImages,
  productMasterCategories,
  productMasterPurchaseConstraints,
  productMasterVariants,
  productMasterVersions,
  productPurchaseConstraints,
  productVariants,
  variantOptionValues,
} from '../../../schema/catalog.schema';

type SelectFixtures = {
  versions?: Array<Record<string, unknown>>;
  categories?: Array<Record<string, unknown> & { showOnMainCategory?: boolean }>;
  variants?: Array<Record<string, unknown> & { id: string; optionValueIds?: string[] }>;
  images?: Array<Record<string, unknown>>;
  purchaseConstraint?: Record<string, unknown> | null;
};

function promiseTerminal<T>(rows: T[]) {
  const promise = Promise.resolve(rows);
  return {
    orderBy: jest.fn(() => promise),
    limit: jest.fn(() => promise),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
    [Symbol.toStringTag]: 'Promise',
  };
}

function makeSelectTx(fixtures: SelectFixtures) {
  const variantRows = (fixtures.variants ?? []).map(({ optionValueIds: _optionValueIds, ...variant }) => ({
    product_variants: variant,
  }));
  const optionRows = (fixtures.variants ?? []).flatMap((variant) =>
    (variant.optionValueIds ?? []).map((optionValueId) => ({
      variantId: variant.id,
      optionValueId,
    })),
  );
  const categoryRows = (fixtures.categories ?? []).map((category) => ({
    ...category,
    displaySettings: { showOnMainCategory: category.showOnMainCategory ?? false },
  }));
  const purchaseConstraintRows = fixtures.purchaseConstraint ? [fixtures.purchaseConstraint] : [];

  const rowsForTable = (table: unknown) => {
    if (table === productMasterVersions) return fixtures.versions ?? [];
    if (table === productMasterCategories) return categoryRows;
    if (table === productMasterVariants) return variantRows;
    if (table === variantOptionValues) return optionRows;
    if (table === productImages) return fixtures.images ?? [];
    if (table === productMasterPurchaseConstraints) return purchaseConstraintRows;
    if (table === productPurchaseConstraints) return purchaseConstraintRows;
    if (table === productVariants) return variantRows;
    return [];
  };

  return {
    select: jest.fn(() => ({
      from: jest.fn((table: unknown) => {
        const rows = rowsForTable(table);
        const chain: any = {
          innerJoin: jest.fn(() => chain),
          where: jest.fn(() => promiseTerminal(rows)),
          orderBy: jest.fn(() => Promise.resolve(rows)),
          limit: jest.fn(() => Promise.resolve(rows)),
        };
        return chain;
      }),
    })),
  };
}

describe('ProductVersionReadLoader', () => {
  it('loads categories scoped by masterId and versionId and preserves isPrimary', async () => {
    const loader = new ProductVersionReadLoader();
    const tx = makeSelectTx({
      categories: [
        {
          id: 'cat-active-primary',
          name: 'Lip',
          slug: 'lip',
          path: '/makeup/lip',
          parentId: 'cat-makeup',
          isActive: true,
          visibility: true,
          showOnMainCategory: true,
          thumbnailFileId: 'file-cat-1',
          isPrimary: true,
        },
      ],
    });

    await expect(loader.getCategories(tx as any, 'master-1', 'version-2')).resolves.toEqual([
      {
        id: 'cat-active-primary',
        name: 'Lip',
        slug: 'lip',
        path: '/makeup/lip',
        parentId: 'cat-makeup',
        isActive: true,
        visibility: true,
        showOnMainCategory: true,
        thumbnailFileId: 'file-cat-1',
        isPrimary: true,
      },
    ]);
  });

  it('loads variants as neutral facts and includes raw option value ids', async () => {
    const loader = new ProductVersionReadLoader();
    const tx = makeSelectTx({
      variants: [
        {
          id: 'variant-1',
          variantName: 'Red',
          variantCode: 'AY-RED',
          isDefault: false,
          status: 'active',
          displayOrder: 10,
          optionValueIds: ['value-red'],
        },
        {
          id: 'variant-2',
          variantName: 'Blue',
          variantCode: 'AY-BLUE',
          isDefault: false,
          status: 'inactive',
          displayOrder: 20,
          optionValueIds: ['value-blue'],
        },
      ],
    });

    await expect(loader.getVariants(tx as any, 'master-1', 'version-2')).resolves.toEqual([
      expect.objectContaining({ id: 'variant-1', status: 'active', optionValueIds: ['value-red'] }),
      expect.objectContaining({ id: 'variant-2', status: 'inactive', optionValueIds: ['value-blue'] }),
    ]);
  });

  it('loads product images sorted with primary image first and raw File UUIDs only', async () => {
    const loader = new ProductVersionReadLoader();
    const tx = makeSelectTx({
      images: [
        { id: 'img-1', versionId: 'version-2', fileId: 'file-primary', isPrimary: true, sortOrder: 10 },
        { id: 'img-2', versionId: 'version-2', fileId: 'file-secondary', isPrimary: false, sortOrder: 20 },
      ],
    });

    await expect(loader.getImages(tx as any, 'version-2')).resolves.toEqual([
      expect.objectContaining({ fileId: 'file-primary', isPrimary: true }),
      expect.objectContaining({ fileId: 'file-secondary', isPrimary: false }),
    ]);
  });

  it('returns null when no purchase constraint mapping exists', async () => {
    const loader = new ProductVersionReadLoader();
    const tx = makeSelectTx({ purchaseConstraint: null });

    await expect(loader.getPurchaseConstraint(tx as any, 'master-1', 'version-2')).resolves.toBeNull();
  });
});
