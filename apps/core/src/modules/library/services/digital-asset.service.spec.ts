import { DigitalAssetService } from './digital-asset.service';
import { digitalAssets } from '../schema/library.schema';

/**
 * DigitalAssetService.rollbackToFileVersion 의 행동을 fake tx 로 단위 검증한다.
 *
 * 검증 포인트:
 *  - asset 미존재 → NotFoundError
 *  - asset deleted → NotFoundError
 *  - version row 미존재 → NotFoundError
 *  - version 이 다른 asset 소속 → NotFoundError
 *  - 이미 current 인 version 으로 rollback → BadRequestError
 *  - 정상 rollback 시 digitalAssets.currentFileVersionId 업데이트가 일어남
 */
describe('DigitalAssetService.rollbackToFileVersion', () => {
  type Asset = {
    id: string;
    deletedAt: Date | null;
    currentFileVersionId: string | null;
  };
  type Version = { id: string; assetId: string };

  function makeFakeTx(opts: {
    asset?: Asset;
    version?: Version;
  }) {
    const updates: Array<{ table: any; set: any }> = [];
    let selectCallCount = 0;

    const tx: any = {
      select: (_cols?: any) => ({
        from: (_t: any) => ({
          where: (_w: any) => {
            const idx = selectCallCount++;
            // call 0: load asset row
            if (idx === 0) {
              return opts.asset
                ? [{ ...opts.asset, name: 'X', description: null, mimeType: null, thumbnailUrl: null, createdAt: new Date(), updatedAt: new Date(), createdBy: null, updatedBy: null, deletedBy: null }]
                : [];
            }
            // call 1: load version row
            if (idx === 1) return opts.version ? [opts.version] : [];
            // call 2 (only on success): _loadAssetOrThrow re-reads asset
            if (idx === 2) {
              return opts.asset
                ? [{ ...opts.asset, name: 'X', description: null, mimeType: null, thumbnailUrl: null, createdAt: new Date(), updatedAt: new Date(), createdBy: null, updatedBy: null, deletedBy: null, currentFileVersionId: opts.version?.id ?? null }]
                : [];
            }
            // call 3 (only on success): _loadAssetOrThrow reads version row
            return [];
          },
        }),
      }),
      update: (table: any) => ({
        set: (set: any) => ({
          where: (_w: any) => {
            updates.push({ table, set });
            return Promise.resolve();
          },
        }),
      }),
    };
    return { tx, updates };
  }

  function makeService(): DigitalAssetService {
    const fakeDb: any = { db: {}, run: (fn: any, tx?: any) => fn(tx) };
    return new DigitalAssetService(fakeDb);
  }

  it('asset 가 없으면 NotFoundError', async () => {
    const service = makeService();
    const { tx } = makeFakeTx({});
    await expect(
      service.rollbackToFileVersion('a-1', 'v-1', 'op-1', tx),
    ).rejects.toThrow(/Digital asset not found/);
  });

  it('asset 가 soft-deleted 면 NotFoundError', async () => {
    const service = makeService();
    const { tx } = makeFakeTx({
      asset: { id: 'a-1', deletedAt: new Date(), currentFileVersionId: 'v-2' },
    });
    await expect(
      service.rollbackToFileVersion('a-1', 'v-1', 'op-1', tx),
    ).rejects.toThrow(/Digital asset not found/);
  });

  it('version 이 없으면 NotFoundError', async () => {
    const service = makeService();
    const { tx } = makeFakeTx({
      asset: { id: 'a-1', deletedAt: null, currentFileVersionId: 'v-2' },
    });
    await expect(
      service.rollbackToFileVersion('a-1', 'v-1', 'op-1', tx),
    ).rejects.toThrow(/does not belong to asset/);
  });

  it('version 이 다른 asset 소속이면 NotFoundError', async () => {
    const service = makeService();
    const { tx } = makeFakeTx({
      asset: { id: 'a-1', deletedAt: null, currentFileVersionId: 'v-2' },
      version: { id: 'v-1', assetId: 'a-OTHER' },
    });
    await expect(
      service.rollbackToFileVersion('a-1', 'v-1', 'op-1', tx),
    ).rejects.toThrow(/does not belong to asset/);
  });

  it('이미 current 인 version 으로 rollback 하면 BadRequestError', async () => {
    const service = makeService();
    const { tx } = makeFakeTx({
      asset: { id: 'a-1', deletedAt: null, currentFileVersionId: 'v-1' },
      version: { id: 'v-1', assetId: 'a-1' },
    });
    await expect(
      service.rollbackToFileVersion('a-1', 'v-1', 'op-1', tx),
    ).rejects.toThrow(/already the current version/);
  });

  it('정상 rollback 시 digitalAssets.currentFileVersionId 를 업데이트', async () => {
    const service = makeService();
    const { tx, updates } = makeFakeTx({
      asset: { id: 'a-1', deletedAt: null, currentFileVersionId: 'v-2' },
      version: { id: 'v-1', assetId: 'a-1' },
    });

    await service.rollbackToFileVersion('a-1', 'v-1', 'op-1', tx);

    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe(digitalAssets);
    expect(updates[0].set.currentFileVersionId).toBe('v-1');
    expect(updates[0].set.updatedBy).toBe('op-1');
    expect(updates[0].set.updatedAt).toBeInstanceOf(Date);
  });
});
