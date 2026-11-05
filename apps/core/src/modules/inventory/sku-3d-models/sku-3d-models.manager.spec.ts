import { Sku3dModelsManager } from './sku-3d-models.manager';
import { ProductModel3dProjection } from '../../catalog/core/products/services/product-model3d-projection';

/** Queue the DB boundary; application selection, validation, and publication remain real. */
function fixture(options: { before?: string; after?: string; metadata?: object; publishError?: boolean } = {}) {
  const reads: any[][] = [];
  const trace: string[] = [];
  const writes: any[] = [];
  const query: any = {
    from: () => query,
    innerJoin: () => query,
    where: () => query,
    orderBy: () => query,
    for: () => {
      trace.push('lock');
      return query;
    },
    then: (resolve: any, reject: any) => Promise.resolve(reads.shift() ?? []).then(resolve, reject),
  };
  const tx: any = {
    select: () => query,
    selectDistinct: () => query,
    insert: () => ({
      values: (value: any) => {
        writes.push(value);
        trace.push('insert');

        return { returning: async () => [{ id: 'new', ...value }] };
      },
    }),
    update: () => ({
      set: (value: any) => {
        writes.push(value);

        return {
          where: () => ({
            returning: async () => {
              return [{ id: 'model', skuId: 'sku', version: 1, glbFileId: 'file', ...value }];
            },
          }),
        };
      },
    }),
  };
  let rolledBack = false;
  const db: any = {
    db: tx,
    run: async (fn: any) => {
      try {
        return await fn(tx);
      } catch (error) {
        writes.length = 0;
        rolledBack = true;
        throw error;
      }
    },
  };
  const files: any = {
    fetchMetadata: jest.fn().mockResolvedValue({
      status: 'active',
      isPublic: true,
      contextId: 'sku-3d-model',
      mimeType: 'model/gltf-binary',
      ...options.metadata,
    }),
  };
  const loader: any = {
    getFileId: jest.fn().mockResolvedValueOnce(options.before).mockResolvedValueOnce(options.after),
  };
  const assembler: any = {
    assembleActiveVersionSnapshot: jest.fn().mockResolvedValue({
      snapshot: { name: 'Product', model3dFileId: options.after },
      categoryIds: [],
      primaryCategoryId: null,
    }),
  };
  const publisher: any = {
    enqueue: options.publishError ? jest.fn().mockRejectedValue(new Error('outbox failed')) : jest.fn(),
  };
  const manager = new Sku3dModelsManager(db, files, new ProductModel3dProjection(loader, assembler, publisher));
  const existing = { id: 'model', skuId: 'sku', version: 1, glbFileId: 'file', status: 'needs_revision' };
  const targets = [{ masterId: 'master', versionId: 'version' }];

  function reviewReads() {
    reads.push([existing], [{ id: 'sku', isDeleted: false }], targets, [{ id: 'master' }], targets, [existing]);
  }

  function visibilityReads(model?: object) {
    if (model) {
      reads.push([model]);
    }

    reads.push([{ id: 'sku', isDeleted: false }], targets, [{ id: 'master' }], targets);
  }

  return {
    manager,
    existing,
    visibilityReads,
    reads,
    writes,
    trace,
    tx,
    files,
    loader,
    assembler,
    publisher,
    reviewReads,
    rolledBack: () => rolledBack,
  };
}

describe('Sku3dModelsManager', () => {
  it('allocates the next immutable version after locking the SKU', async () => {
    const f = fixture();
    f.reads.push([{ id: 'sku', isDeleted: false }], [{ version: 4 }]);

    const row = await f.manager.register('sku', { status: 'failed', notes: { reason: 'mesh failed' } }, 'actor');

    expect(row.version).toBe(5);
    expect(f.trace).toEqual(['lock', 'insert']);
    expect(f.publisher.enqueue).not.toHaveBeenCalled();
  });

  it('publishes changed product selection in the same transaction', async () => {
    const f = fixture({ after: 'file' });
    f.reviewReads();

    await f.manager.review('model', { status: 'approved' }, 'actor');

    expect(f.publisher.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'ProductMasterActiveVersionChanged',
        payload: expect.objectContaining({ snapshot: expect.objectContaining({ model3dFileId: 'file' }) }),
      }),
      f.tx,
    );
  });

  it('does not publish when another variant remains representative', async () => {
    const f = fixture({ before: 'other', after: 'other' });
    f.reviewReads();

    await f.manager.review('model', { status: 'approved' }, 'actor');

    expect(f.publisher.enqueue).not.toHaveBeenCalled();
  });

  it('publishes revocation and fallback', async () => {
    const f = fixture({ before: 'file', after: 'prior' });
    f.reviewReads();

    await f.manager.review('model', { status: 'needs_revision' }, 'actor');

    expect(f.publisher.enqueue).toHaveBeenCalledTimes(1);
  });

  it('rolls review back when transactional outbox publication fails', async () => {
    const f = fixture({ after: 'file', publishError: true });
    f.reviewReads();

    await expect(f.manager.review('model', { status: 'approved' }, 'actor')).rejects.toThrow('outbox failed');
    expect(f.writes).toEqual([]);
    expect(f.rolledBack()).toBe(true);
  });

  it('routes batch review refreshes through bulk_import', async () => {
    const f = fixture({ after: 'file' });
    f.reviewReads();

    await f.manager.reviewBatch(['model'], { status: 'approved' }, 'actor');

    expect(f.publisher.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ origin: 'bulk_import' }) }),
      f.tx,
    );
  });

  it.each([
    { status: 'pending' },
    { status: 'deleted' },
    { isPublic: false },
    { contextId: 'product-image' },
    { mimeType: 'image/png' },
  ])('rejects an invalid approved GLB: %p', async (metadata) => {
    const f = fixture({ metadata });
    f.reviewReads();

    await expect(f.manager.review('model', { status: 'approved' }, 'actor')).rejects.toThrow(
      'completed public sku-3d-model GLB',
    );
    expect(f.writes).toEqual([]);
    expect(f.publisher.enqueue).not.toHaveBeenCalled();
  });

  it('rejects approval without a GLB', async () => {
    const f = fixture();
    f.reads.push([{ id: 'sku', isDeleted: false }], [{ version: null }]);

    await expect(f.manager.register('sku', { status: 'approved' }, 'actor')).rejects.toThrow('GLB file is required');
    expect(f.writes).toEqual([]);
  });

  it('records who uploaded the version', async () => {
    const f = fixture();
    f.reads.push([{ id: 'sku', isDeleted: false }], [{ version: 1 }]);

    await f.manager.register('sku', { status: 'draft', glbFileId: 'file' }, 'actor', '권우재');

    expect(f.writes[0]).toEqual(
      expect.objectContaining({ status: 'draft', uploadedById: 'actor', uploadedByLabel: '권우재' }),
    );
  });

  it('publishes one version and demotes the other public versions of the SKU', async () => {
    const f = fixture({ after: 'file' });
    f.visibilityReads({ ...f.existing, status: 'draft' });

    const row = await f.manager.publish('model', 'actor');

    expect(f.files.fetchMetadata).toHaveBeenCalledWith('file', 'actor');
    expect(f.writes).toEqual([{ status: 'draft' }, { status: 'approved' }]);
    expect(row.status).toBe('approved');
    expect(f.publisher.enqueue).toHaveBeenCalledTimes(1);
  });

  it('refuses to publish an invalid GLB', async () => {
    const f = fixture({ metadata: { isPublic: false } });
    f.visibilityReads({ ...f.existing, status: 'draft' });

    await expect(f.manager.publish('model', 'actor')).rejects.toThrow('completed public sku-3d-model GLB');
    expect(f.writes).toEqual([]);
  });

  it('rejects publishing a missing version', async () => {
    const f = fixture();

    await expect(f.manager.publish('missing', 'actor')).rejects.toThrow('SKU 3D model not found');
  });

  it('unpublishes every public version of the SKU and withdraws the product model', async () => {
    const f = fixture({ before: 'file' });
    f.visibilityReads();

    await f.manager.unpublish('sku');

    expect(f.writes).toEqual([{ status: 'draft' }]);
    expect(f.publisher.enqueue).toHaveBeenCalledTimes(1);
  });
});
