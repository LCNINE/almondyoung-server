import { ProductVersionReadLoader } from './product-version-read.loader';
import {
  productImages,
  productMasterCategories,
  productMasterPurchaseConstraints,
  productMasterVariants,
  productMasterVersions,
  productMasters,
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
  const terminal = {
    orderBy: jest.fn(() => promise),
    limit: jest.fn(() => promise),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
    [Symbol.toStringTag]: 'Promise',
  };
  return terminal;
}

function makeSelectTx(fixtures: SelectFixtures) {
  const chains: Array<Record<string, any> & { table: unknown }> = [];
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
    __chains: chains,
    select: jest.fn(() => ({
      from: jest.fn((table: unknown) => {
        const rows = rowsForTable(table);
        const chain: any = {
          table,
          innerJoin: jest.fn(() => chain),
          where: jest.fn(() => {
            const terminal = promiseTerminal(rows);
            chain.lastTerminal = terminal;
            return terminal;
          }),
          orderBy: jest.fn(() => Promise.resolve(rows)),
          limit: jest.fn(() => Promise.resolve(rows)),
        };
        chains.push(chain);
        return chain;
      }),
    })),
  };
}

function getChain(tx: ReturnType<typeof makeSelectTx>, table: unknown) {
  const chain = tx.__chains.find((candidate) => candidate.table === table);
  expect(chain).toBeDefined();
  return chain!;
}

function conditionContains(condition: unknown, target: unknown): boolean {
  const seen = new WeakSet<object>();
  const visit = (value: unknown): boolean => {
    if (value === target) {
      return true;
    }
    if (!value || typeof value !== 'object') {
      return false;
    }
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);

    if ('columnType' in value && 'table' in value && 'name' in value) {
      return false;
    }

    if (Array.isArray(value)) {
      return value.some(visit);
    }

    return Object.values(value).some(visit);
  };

  return visit(condition);
}

function expectWhereIncludesScope(
  chain: Record<string, any>,
  masterIdColumn: unknown,
  versionIdColumn: unknown,
  masterId: string,
  versionId: string,
) {
  expect(chain.where).toHaveBeenCalledTimes(1);
  const condition = chain.where.mock.calls[0][0];

  expect(conditionContains(condition, masterIdColumn)).toBe(true);
  expect(conditionContains(condition, masterId)).toBe(true);
  expect(conditionContains(condition, versionIdColumn)).toBe(true);
  expect(conditionContains(condition, versionId)).toBe(true);
}

describe('ProductVersionReadLoader', () => {
  it('loads active versions only when the master and version are not soft-deleted', async () => {
    const loader = new ProductVersionReadLoader();
    const tx = makeSelectTx({
      versions: [{ product_master_versions: { id: 'version-2', masterId: 'master-1', status: 'active' } }],
    });

    await expect(loader.getActiveVersion(tx as any, 'master-1')).resolves.toEqual({
      id: 'version-2',
      masterId: 'master-1',
      status: 'active',
    });

    const chain = getChain(tx, productMasterVersions);
    const condition = chain.where.mock.calls[0][0];

    expect(conditionContains(condition, productMasterVersions.masterId)).toBe(true);
    expect(conditionContains(condition, 'master-1')).toBe(true);
    expect(conditionContains(condition, productMasterVersions.status)).toBe(true);
    expect(conditionContains(condition, 'active')).toBe(true);
    expect(conditionContains(condition, productMasters.deletedAt)).toBe(true);
    expect(conditionContains(condition, productMasterVersions.deletedAt)).toBe(true);
  });

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

    expectWhereIncludesScope(
      getChain(tx, productMasterCategories),
      productMasterCategories.masterId,
      productMasterCategories.versionId,
      'master-1',
      'version-2',
    );
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

    expectWhereIncludesScope(
      getChain(tx, productMasterVariants),
      productMasterVariants.masterId,
      productMasterVariants.versionId,
      'master-1',
      'version-2',
    );
    expect(getChain(tx, variantOptionValues).where).toHaveBeenCalledTimes(1);
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

    const chain = getChain(tx, productImages);
    expect(chain.lastTerminal.orderBy).toHaveBeenCalledTimes(1);
  });

  it('returns null when no purchase constraint mapping exists', async () => {
    const loader = new ProductVersionReadLoader();
    const tx = makeSelectTx({ purchaseConstraint: null });

    await expect(loader.getPurchaseConstraint(tx as any, 'master-1', 'version-2')).resolves.toBeNull();

    expectWhereIncludesScope(
      getChain(tx, productMasterPurchaseConstraints),
      productMasterPurchaseConstraints.masterId,
      productMasterPurchaseConstraints.versionId,
      'master-1',
      'version-2',
    );
  });
});
