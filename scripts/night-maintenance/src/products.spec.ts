import { runProducts, ProductDependencies, ProductVersion } from './products';

function fixture() {
  let active: ProductVersion = {
    id: 'old',
    status: 'active',
    name: '상품',
    productInfo: { origin: '한국' },
    variants: [
      {
        variantName: '옵션',
        variantCode: null,
        displayOrder: 0,
        status: 'active',
        priceSet: { basePrice: 1000 },
        optionValues: [{ displayName: '10ml' }],
      },
    ],
  };
  let draft: ProductVersion | undefined;
  const state = new Map<string, unknown>();
  const operations: string[] = [];
  const deps: ProductDependencies = {
    api: {
      current: async () => JSON.parse(JSON.stringify(active)),
      draft: async () => JSON.parse(JSON.stringify(draft)),
      create: async () => {
        operations.push('create');
        draft = { ...active, id: 'draft', status: 'draft' };
        return draft;
      },
      update: async (_, __, productInfo) => {
        operations.push('update');
        draft!.productInfo = productInfo;
        return draft!;
      },
      publish: async () => {
        operations.push('publish');
        active = { ...draft!, status: 'active' };
      },
    },
    store: {
      read: async <T>(key: string) => state.get(key) as T | undefined,
      write: async (key, value) => {
        state.set(key, JSON.parse(JSON.stringify(value)));
      },
    },
    checkWrite: async () => {},
    checkLoad: async () => {},
    canWrite: () => true,
    sleep: async () => {},
    log: () => {},
    dryRun: false,
  };
  const proposals = [
    { masterId: 'm', name: '상품', expectedActiveVersionId: 'old', setProductInfo: { capacity: '10ml' } },
  ];

  return {
    deps,
    proposals,
    operations,
    state,
    active: () => active,
    setActive: (value: ProductVersion) => {
      active = value;
    },
  };
}

describe('preserving product metadata backfill', () => {
  it('rechecks completed products without consuming the next night through mutation pacing', async () => {
    const f = fixture();

    await runProducts(f.proposals, f.deps);

    const sleeps: number[] = [];
    f.deps.sleep = async (ms) => {
      sleeps.push(ms);
    };
    f.operations.length = 0;

    const completed = f.state.get('products/m.json');
    const proposals = Array.from({ length: 21 }, (_, index) => {
      const masterId = `completed-${index}`;
      f.state.set(`products/${masterId}.json`, completed);

      return { ...f.proposals[0], masterId };
    });

    expect(await runProducts(proposals, f.deps)).toMatchObject({ verified: 21, remaining: 0 });
    expect(f.operations).toEqual([]);
    expect(sleeps).toEqual([]);
  });

  it('never creates a draft during dry-run', async () => {
    const f = fixture();
    f.deps.dryRun = true;
    expect(await runProducts(f.proposals, f.deps)).toMatchObject({ status: 'dry-run' });
    expect(f.operations).toEqual([]);
  });

  it('skips changed active versions and existing values', async () => {
    const f = fixture();
    f.setActive({ ...f.active(), id: 'operator-new-version' });
    expect(await runProducts(f.proposals, f.deps)).toMatchObject({ skipped: 1 });
    expect(f.operations).toEqual([]);
  });

  it('copies mappings, preserves existing info and prices, and records intent before draft creation', async () => {
    const f = fixture();
    const create = f.deps.api.create;
    f.deps.api.create = async (...args) => {
      expect(f.state.get('products/m.json')).toMatchObject({ phase: 'create-intent' });
      return create(...args);
    };
    expect(await runProducts(f.proposals, f.deps)).toMatchObject({ verified: 1 });
    expect(f.active().productInfo).toEqual({ origin: '한국', capacity: '10ml' });
    expect(f.active().variants![0].priceSet).toEqual({ basePrice: 1000 });
  });

  it('refuses publication when a draft changes unrelated fields', async () => {
    const f = fixture();
    const update = f.deps.api.update;
    f.deps.api.update = async (...args) => ({ ...(await update(...args)), name: 'changed by accident' });
    await expect(runProducts(f.proposals, f.deps)).rejects.toThrow('Unrelated product');
    expect(f.operations).not.toContain('publish');
  });

  it('checks a resumed updated draft before publishing it', async () => {
    const f = fixture();
    const originalCheck = f.deps.checkWrite;
    let checks = 0;
    f.deps.checkWrite = async () => {
      await originalCheck();
      if (++checks === 4) throw new Error('interrupted before publish');
    };
    await expect(runProducts(f.proposals, f.deps)).rejects.toThrow('interrupted');
    const state = f.state.get('products/m.json') as { phase: string };
    state.phase = 'updated';
    f.deps.checkWrite = originalCheck;
    const readDraft = f.deps.api.draft;
    f.deps.api.draft = async (...args) => ({ ...(await readDraft(...args)), name: 'operator edit' });

    await expect(runProducts(f.proposals, f.deps)).rejects.toThrow('Unrelated product');
    expect(f.operations).not.toContain('publish');
  });

  it('reconciles an unknown publish response without repeating publish', async () => {
    const f = fixture();
    const publish = f.deps.api.publish;
    f.deps.api.publish = async (...args) => {
      await publish(...args);
      throw new Error('connection lost after commit');
    };
    await expect(runProducts(f.proposals, f.deps)).rejects.toThrow('connection lost after commit');
    expect(f.state.get('products/m.json')).toMatchObject({ phase: 'verified' });
    expect(f.operations.filter((value) => value === 'publish')).toHaveLength(1);
  });

  it('preserves operator edits to an owned draft by stopping before PUT', async () => {
    const f = fixture();
    const readDraft = f.deps.api.draft;
    f.deps.api.draft = async (...args) => ({
      ...(await readDraft(...args)),
      productInfo: { origin: 'operator value' },
    });
    await expect(runProducts(f.proposals, f.deps)).rejects.toThrow('Owned draft changed');
    expect(f.operations).toEqual(['create']);
  });

  it('does not create another draft after an uncertain creation', async () => {
    const f = fixture();
    const create = f.deps.api.create;
    f.deps.api.create = async (...args) => {
      await create(...args);
      throw new Error('connection lost');
    };
    await expect(runProducts(f.proposals, f.deps)).rejects.toThrow();
    await expect(runProducts(f.proposals, f.deps)).rejects.toThrow('Unresolved draft creation');
    expect(f.operations.filter((value) => value === 'create')).toHaveLength(1);
  });

  it('paces requests and waits five minutes after twenty products', async () => {
    const f = fixture();
    f.deps.api.current = async () => ({ ...f.active(), id: 'old', productInfo: {} });
    const sleeps: number[] = [];
    f.deps.sleep = async (ms) => {
      sleeps.push(ms);
    };
    f.deps.api.publish = async () => {};
    f.deps.api.current = async () => ({ id: 'old', status: 'active', productInfo: { capacity: 'already set' } });
    const proposals = Array.from({ length: 21 }, (_, index) => ({ ...f.proposals[0], masterId: `m-${index}` }));
    await runProducts(proposals, f.deps);
    expect(sleeps.filter((ms) => ms === 300000)).toHaveLength(1);
  });
});
