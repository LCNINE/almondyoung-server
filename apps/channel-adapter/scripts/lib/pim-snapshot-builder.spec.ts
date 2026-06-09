import { PimSnapshotBuilder } from './pim-snapshot-builder';

type FakePimDb = ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>) & {
  end: jest.Mock;
};

const masterRows = [
  {
    master_id: 'master-1',
    version_id: 'version-1',
    version: 7,
    name: 'Constrained Product',
    status: 'active',
    is_wholesale_only: false,
    is_membership_only: false,
  },
];

const variantRows = [
  {
    master_id: 'master-1',
    version_id: 'version-1',
    variant_id: 'variant-1',
    variant_name: 'Default',
    variant_code: 'SKU-1',
    is_default: true,
    status: 'active',
    base_price: '10000',
    option_combination: [],
  },
];

function createFakePimDb(purchaseConstraintRows: unknown[] = []): FakePimDb {
  const db = jest.fn(async (strings: TemplateStringsArray) => {
    const sql = strings.join(' ');

    if (sql.includes('FROM product_masters pm')) {
      return masterRows;
    }

    if (sql.includes('FROM product_master_categories pmc')) {
      return [];
    }

    if (sql.includes('FROM product_master_variants pmv')) {
      return variantRows;
    }

    if (sql.includes('FROM product_master_option_groups pmog')) {
      return [];
    }

    if (sql.includes('FROM product_master_purchase_constraints pmpc')) {
      return purchaseConstraintRows;
    }

    throw new Error(`Unexpected query: ${sql}`);
  }) as FakePimDb;

  db.end = jest.fn();
  return db;
}

describe('PimSnapshotBuilder', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('includes purchaseConstraint when DB rows exist', async () => {
    const pimDb = createFakePimDb([
      {
        master_id: 'master-1',
        version_id: 'version-1',
        requires_membership: true,
        lifetime_quantity_limit: 3,
      },
    ]);
    const builder = new PimSnapshotBuilder(pimDb as any);

    const snapshots = await builder.fetchActiveMasters(10, 0);

    expect(snapshots[0].purchaseConstraint).toEqual({
      requiresMembership: true,
      lifetimeQuantityLimit: 3,
    });
  });

  it('leaves purchaseConstraint undefined when no purchase constraint row exists', async () => {
    const pimDb = createFakePimDb();
    const builder = new PimSnapshotBuilder(pimDb as any);

    const snapshots = await builder.fetchActiveMasters(10, 0);

    expect(snapshots[0].purchaseConstraint).toBeUndefined();
  });
});
