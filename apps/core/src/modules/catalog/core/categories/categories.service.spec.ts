jest.mock(
  '@packages/event-contracts/streams/product.stream',
  () => ({
    PRODUCT_STREAM: { topic: { topic: 'products.events.v1' }, aggregateType: 'Product' },
  }),
  { virtual: true },
);

import { ProductCategoriesService } from './categories.service';

describe('ProductCategoriesService Medusa projection outbox events', () => {
  function makeCategory(overrides: Record<string, any> = {}) {
    return {
      id: 'cat-1',
      name: 'Lip',
      slug: 'lip',
      description: null,
      parentId: null,
      level: 0,
      path: 'cat-1',
      sortOrder: 0,
      isActive: true,
      visibility: true,
      imageUrl: null,
      displaySettings: null,
      seoConfig: null,
      templateConfig: null,
      createdAt: new Date('2026-06-07T00:00:00.000Z'),
      updatedAt: new Date('2026-06-07T00:00:00.000Z'),
      ...overrides,
    };
  }

  function makeService() {
    const tx = {
      update: jest.fn(() => ({
        set: () => ({
          where: () => ({
            returning: () => [makeCategory({ name: 'Updated Lip' })],
          }),
        }),
      })),
    };
    const db = {
      run: jest.fn(async (callback: (trx: typeof tx) => Promise<unknown>, t?: typeof tx) => callback(t ?? tx)),
    };
    const outboxPublisher = {
      saveEvent: jest.fn().mockResolvedValue(undefined),
    };

    const projectionSnapshotAssembler = {
      assembleActiveVersionSnapshot: jest.fn(),
    };

    const service = new (ProductCategoriesService as any)(
      db,
      {} as any,
      projectionSnapshotAssembler,
      outboxPublisher,
    ) as ProductCategoriesService;

    return { service, tx, outboxPublisher, projectionSnapshotAssembler };
  }

  it('enqueues CategoryChanged through the transactional outbox using the category transaction', async () => {
    const { service, tx, outboxPublisher } = makeService();

    await service.updateCategory('cat-1', { name: 'Updated Lip' } as any);

    expect(outboxPublisher.saveEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'products.events.v1',
        eventType: 'CategoryChanged',
        aggregateType: 'Product',
        aggregateId: 'cat-1',
        payload: expect.objectContaining({
          categoryId: 'cat-1',
          changeType: 'updated',
          category: expect.objectContaining({
            id: 'cat-1',
            name: 'Updated Lip',
            slug: 'lip',
          }),
        }),
      }),
      tx,
    );
  });
});

describe('ProductCategoriesService 상품-카테고리 변경 시 프로젝션 재발행', () => {
  /**
   * drizzle 쿼리 빌더를 순서대로 소비하는 최소 목.
   * select 호출 순서대로 `results` 를 하나씩 돌려준다 (innerJoin 유무 무관).
   */
  function makeTx(results: unknown[][]) {
    const queue = [...results];
    const take = () => Promise.resolve(queue.shift() ?? []);
    const whereable = () => ({ where: take });
    const tx = {
      select: jest.fn(() => ({
        from: () => ({
          where: take,
          innerJoin: () => whereable(),
        }),
      })),
      insert: jest.fn(() => ({ values: jest.fn().mockResolvedValue(undefined) })),
      delete: jest.fn(() => ({ where: jest.fn().mockResolvedValue(undefined) })),
      update: jest.fn(() => ({ set: () => ({ where: jest.fn().mockResolvedValue(undefined) }) })),
    };
    return tx;
  }

  function makeService(tx: ReturnType<typeof makeTx>) {
    const db = {
      run: jest.fn(async (callback: (trx: unknown) => Promise<unknown>, t?: unknown) => callback(t ?? tx)),
    };
    const outboxPublisher = { saveEvent: jest.fn().mockResolvedValue(undefined) };
    const projectionSnapshotAssembler = {
      assembleActiveVersionSnapshot: jest.fn().mockResolvedValue({
        snapshot: { name: '아몬드 립' },
        categoryIds: ['cat-2'],
        primaryCategoryId: 'cat-2',
      }),
    };

    const service = new (ProductCategoriesService as any)(
      db,
      {} as any,
      projectionSnapshotAssembler,
      outboxPublisher,
    ) as ProductCategoriesService;

    return { service, outboxPublisher, projectionSnapshotAssembler };
  }

  const productEvents = (outboxPublisher: { saveEvent: jest.Mock }) =>
    outboxPublisher.saveEvent.mock.calls.filter(
      ([params]) => params.eventType === 'ProductMasterActiveVersionChanged',
    );

  it('addProductsToCategory: 새로 연결된 활성 버전만 스냅샷과 함께 재발행한다', async () => {
    const tx = makeTx([
      [{ id: 'cat-2' }], // 대상 카테고리
      [{ versionId: 'v1', masterId: 'm1', version: 1 }], // 활성 버전
      [], // 기존 연결 없음
    ]);
    const { service, outboxPublisher } = makeService(tx);

    await service.addProductsToCategory(['v1'], 'cat-2');

    const events = productEvents(outboxPublisher);
    expect(events).toHaveLength(1);
    expect(events[0][0]).toEqual(
      expect.objectContaining({
        eventType: 'ProductMasterActiveVersionChanged',
        aggregateId: 'm1',
        payload: expect.objectContaining({
          masterId: 'm1',
          versionId: 'v1',
          changeReason: 'published',
          categoryIds: ['cat-2'],
          primaryCategoryId: 'cat-2',
          snapshot: { name: '아몬드 립' },
        }),
      }),
    );
  });

  it('addProductsToCategory: 이미 연결돼 있으면 이벤트를 내보내지 않는다', async () => {
    const tx = makeTx([
      [{ id: 'cat-2' }],
      [{ versionId: 'v1', masterId: 'm1', version: 1 }],
      [{ masterId: 'm1', versionId: 'v1', categoryId: 'cat-2' }], // 이미 연결됨
    ]);
    const { service, outboxPublisher } = makeService(tx);

    await service.addProductsToCategory(['v1'], 'cat-2');

    expect(productEvents(outboxPublisher)).toHaveLength(0);
  });

  it('moveProductsToCategory: 이동한 활성 버전을 재발행한다', async () => {
    const tx = makeTx([
      [{ id: 'cat-2' }],
      [{ versionId: 'v1', masterId: 'm1', version: 1 }],
    ]);
    const { service, outboxPublisher } = makeService(tx);

    await service.moveProductsToCategory(['v1'], 'cat-2');

    const events = productEvents(outboxPublisher);
    expect(events).toHaveLength(1);
    expect(events[0][0].payload).toEqual(expect.objectContaining({ masterId: 'm1', versionId: 'v1' }));
  });

  it('deleteCategory: 카테고리 삭제 이벤트와 함께 걸려 있던 상품도 재발행한다', async () => {
    const tx = makeTx([
      [{ id: 'cat-1' }], // 삭제 대상
      [], // 자식 없음
      [{ masterId: 'm1', versionId: 'v1', categoryId: 'cat-1' }], // 상품 연결
      [{ masterId: 'm1', versionId: 'v1' }], // 그중 활성 버전
    ]);
    const { service, outboxPublisher } = makeService(tx);

    await service.deleteCategory('cat-1');

    expect(
      outboxPublisher.saveEvent.mock.calls.filter(([params]) => params.eventType === 'CategoryChanged'),
    ).toHaveLength(1);
    const events = productEvents(outboxPublisher);
    expect(events).toHaveLength(1);
    expect(events[0][0].aggregateId).toBe('m1');
  });

  it('스냅샷 조립이 실패해도 카테고리 작업은 성공하고 해당 상품만 건너뛴다', async () => {
    const tx = makeTx([
      [{ id: 'cat-2' }],
      [
        { versionId: 'v1', masterId: 'm1', version: 1 },
        { versionId: 'v2', masterId: 'm2', version: 1 },
      ],
      [],
    ]);
    const { service, outboxPublisher, projectionSnapshotAssembler } = makeService(tx);
    projectionSnapshotAssembler.assembleActiveVersionSnapshot
      .mockRejectedValueOnce(new Error('활성 variant 없음'))
      .mockResolvedValueOnce({ snapshot: { name: 'ok' }, categoryIds: ['cat-2'], primaryCategoryId: null });

    await expect(service.addProductsToCategory(['v1', 'v2'], 'cat-2')).resolves.toBeUndefined();

    const events = productEvents(outboxPublisher);
    expect(events).toHaveLength(1);
    expect(events[0][0].aggregateId).toBe('m2');
  });
});

describe('ProductCategoriesService 멤버십 전용 카테고리 지정', () => {
  function makeService(current: Record<string, unknown> | null) {
    const updated = {
      id: 'cat-1',
      name: 'Lip',
      slug: 'lip',
      description: null,
      parentId: null,
      level: 0,
      path: 'cat-1',
      sortOrder: 0,
      isActive: true,
      visibility: true,
      imageUrl: null,
      displaySettings: { showOnMainCategory: true, isVisibleToMembersOnly: true },
      seoConfig: null,
      templateConfig: null,
      createdAt: new Date('2026-06-07T00:00:00.000Z'),
      updatedAt: new Date('2026-06-07T00:00:00.000Z'),
    };
    const setSpy = jest.fn(() => ({ where: () => ({ returning: () => [updated] }) }));
    // select 순서: 현재 display_settings → 자손 목록 → 조상 목록
    const selectQueue: unknown[][] = [current ? [{ displaySettings: current }] : [], [], []];
    const tx = {
      select: jest.fn(() => ({
        from: () => ({ where: () => Promise.resolve(selectQueue.shift() ?? []) }),
      })),
      update: jest.fn(() => ({ set: setSpy })),
      delete: jest.fn(() => ({ where: jest.fn().mockResolvedValue(undefined) })),
      insert: jest.fn(() => ({ values: jest.fn().mockResolvedValue(undefined) })),
    };
    const db = {
      run: jest.fn(async (callback: (trx: unknown) => Promise<unknown>, t?: unknown) => callback(t ?? tx)),
    };
    const outboxPublisher = { saveEvent: jest.fn().mockResolvedValue(undefined) };
    const service = new (ProductCategoriesService as any)(
      db,
      {} as any,
      { assembleActiveVersionSnapshot: jest.fn() },
      outboxPublisher,
    ) as ProductCategoriesService;
    return { service, outboxPublisher, setSpy };
  }

  it('기존 display_settings 를 보존한 채 멤버십 전용 플래그만 병합한다', async () => {
    const { service, setSpy } = makeService({ showOnMainCategory: true });

    await service.updateCategory('cat-1', { isVisibleToMembersOnly: true } as any);

    expect(setSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        displaySettings: { showOnMainCategory: true, isVisibleToMembersOnly: true },
      }),
    );
  });

  it('플래그가 CategoryChanged 스냅샷으로 전달된다', async () => {
    const { service, outboxPublisher } = makeService({ showOnMainCategory: true });

    await service.updateCategory('cat-1', { isVisibleToMembersOnly: true } as any);

    const [params] = outboxPublisher.saveEvent.mock.calls.find(
      ([p]: [{ eventType: string }]) => p.eventType === 'CategoryChanged',
    );
    expect(params.payload.category.displaySettings).toEqual(
      expect.objectContaining({ isVisibleToMembersOnly: true }),
    );
  });

  it('플래그를 안 보내면 display_settings 를 건드리지 않는다', async () => {
    const { service, setSpy } = makeService({ showOnMainCategory: true });

    await service.updateCategory('cat-1', { name: 'Updated' } as any);

    expect(setSpy).toHaveBeenCalledWith(expect.not.objectContaining({ displaySettings: expect.anything() }));
  });
});

describe('ProductCategoriesService 조상/자손 이벤트', () => {
  function makeService(rows: { descendants?: unknown[]; ancestors?: unknown[] } = {}) {
    const updated = {
      id: 'cat-2',
      name: '자식',
      slug: 'child',
      description: null,
      parentId: 'cat-1',
      level: 1,
      path: 'cat-1/cat-2',
      sortOrder: 0,
      isActive: true,
      visibility: true,
      imageUrl: null,
      displaySettings: { isVisibleToMembersOnly: true },
      seoConfig: null,
      templateConfig: null,
      createdAt: new Date('2026-07-27T00:00:00.000Z'),
      updatedAt: new Date('2026-07-27T00:00:00.000Z'),
    };
    // select 순서: 현재 display_settings → 대상의 조상(parentId 체인) → 자손(BFS) → 자손의 조상
    const queue: unknown[][] = [[{ displaySettings: {} }], rows.ancestors ?? []];
    const tx = {
      select: jest.fn(() => ({
        from: () => ({
          where: (cond: unknown) => {
            const text = String(cond ?? '');
            void text;
            return Promise.resolve(queue.shift() ?? []);
          },
        }),
      })),
      update: jest.fn(() => ({ set: () => ({ where: () => ({ returning: () => [updated] }) }) })),
      delete: jest.fn(() => ({ where: jest.fn().mockResolvedValue(undefined) })),
      insert: jest.fn(() => ({ values: jest.fn().mockResolvedValue(undefined) })),
    };
    queue.push(rows.descendants ?? [], rows.ancestors ?? []);
    const db = { run: jest.fn(async (cb: (t: unknown) => Promise<unknown>, t?: unknown) => cb(t ?? tx)) };
    const outboxPublisher = { saveEvent: jest.fn().mockResolvedValue(undefined) };
    const service = new (ProductCategoriesService as any)(
      db,
      {} as any,
      { assembleActiveVersionSnapshot: jest.fn() },
      outboxPublisher,
    ) as ProductCategoriesService;
    return { service, outboxPublisher };
  }

  it('멤버십 전용 변경 시 자손 카테고리 이벤트도 발행한다', async () => {
    const descendant = {
      id: 'cat-3',
      name: '손자',
      slug: 'grand',
      description: null,
      parentId: 'cat-2',
      level: 2,
      path: 'cat-1/cat-2/cat-3',
      sortOrder: 0,
      isActive: true,
      visibility: true,
      imageUrl: null,
      displaySettings: null,
      seoConfig: null,
      templateConfig: null,
      createdAt: new Date('2026-07-27T00:00:00.000Z'),
      updatedAt: new Date('2026-07-27T00:00:00.000Z'),
    };
    const { service, outboxPublisher } = makeService({ descendants: [descendant] });

    await service.updateCategory('cat-2', { isVisibleToMembersOnly: true } as any);

    const ids = outboxPublisher.saveEvent.mock.calls
      .filter(([p]: [{ eventType: string }]) => p.eventType === 'CategoryChanged')
      .map(([p]: [{ aggregateId: string }]) => p.aggregateId);
    expect(ids).toContain('cat-2');
    expect(ids).toContain('cat-3');
  });
});

describe('ProductCategoriesService 레거시 path 대응', () => {
  it('path 가 UUID 체인이 아니어도(cafe24 코드) 조상 조회가 터지지 않는다', async () => {
    // live 마이그레이션 데이터는 path 가 '728' 처럼 코드 문자열이다.
    // 예전 구현은 이 값을 UUID 로 조회해 500 을 냈다 — parentId 체인으로 올라가야 한다.
    const legacy = {
      id: '019fa2dc-670f-7018-ab1e-f46df45ff8aa',
      name: '브랜드',
      slug: 'cafe24-cat-728',
      description: null,
      parentId: null,
      level: 0,
      path: '728',
      sortOrder: 305,
      isActive: true,
      visibility: true,
      imageUrl: null,
      displaySettings: null,
      seoConfig: null,
      templateConfig: null,
      createdAt: new Date('2026-07-27T00:00:00.000Z'),
      updatedAt: new Date('2026-07-27T00:00:00.000Z'),
    };
    const whereSpy = jest.fn(() => Promise.resolve([]));
    const tx = {
      select: jest.fn(() => ({ from: () => ({ where: whereSpy }) })),
      update: jest.fn(() => ({ set: () => ({ where: () => ({ returning: () => [legacy] }) }) })),
      delete: jest.fn(() => ({ where: jest.fn().mockResolvedValue(undefined) })),
      insert: jest.fn(() => ({ values: jest.fn().mockResolvedValue(undefined) })),
    };
    const db = { run: jest.fn(async (cb: (t: unknown) => Promise<unknown>, t?: unknown) => cb(t ?? tx)) };
    const outboxPublisher = { saveEvent: jest.fn().mockResolvedValue(undefined) };
    const service = new (ProductCategoriesService as any)(
      db,
      {} as any,
      { assembleActiveVersionSnapshot: jest.fn() },
      outboxPublisher,
    ) as ProductCategoriesService;

    await expect(service.updateCategory(legacy.id, { name: '브랜드' } as any)).resolves.toBeDefined();

    const event = outboxPublisher.saveEvent.mock.calls.find(
      ([p]: [{ eventType: string }]) => p.eventType === 'CategoryChanged',
    );
    expect(event[0].payload.ancestors).toEqual([]);
  });
});
