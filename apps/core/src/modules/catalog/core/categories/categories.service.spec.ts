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
