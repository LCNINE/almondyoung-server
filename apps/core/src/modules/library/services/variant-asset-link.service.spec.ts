import { VariantAssetLinkService } from './variant-asset-link.service';
import { productVariantDigitalAssetLinks } from '../schema/library.schema';

/**
 * CoW cascading 및 publish-time inheritance 의 데이터 변환 로직 단위 테스트.
 *
 * 실제 DB 호출은 fake tx 로 흉내내고, 어떤 row 가 어떤 query 로 insert/select 되는지 확인한다.
 */
describe('VariantAssetLinkService — CoW + publish 인계 (docs/adr/0004)', () => {
  function makeFakeTx(initialLinks: Array<{ variantId: string; assetId: string }>) {
    const inserted: Array<{ table: any; values: any }> = [];
    const links = [...initialLinks];

    const selectChain = (rows: any[]) => ({
      from: () => ({
        where: () => rows,
      }),
    });

    const tx: any = {
      select: (cols?: any) => {
        return {
          from: (_t: any) => ({
            where: (_w: any) => {
              // The clone path queries assetId by variantId; inherit queries variantId+assetId
              // We expose a simple "return everything matched in initialLinks for variants" function.
              if (cols && 'assetId' in cols && !('variantId' in cols)) {
                return links.map((l) => ({ assetId: l.assetId }));
              }
              if (cols && 'variantId' in cols && 'assetId' in cols) {
                return links.map((l) => ({ variantId: l.variantId, assetId: l.assetId }));
              }
              return links;
            },
          }),
        };
      },
      insert: (table: any) => ({
        values: (vals: any) => ({
          onConflictDoNothing: () => {
            inserted.push({ table, values: vals });
            return Promise.resolve();
          },
          // when no onConflict chained
          then: (resolve: any) => {
            inserted.push({ table, values: vals });
            resolve();
          },
        }),
      }),
      delete: () => ({ where: () => Promise.resolve() }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    };

    // Attach a Promise-then to .insert(...).values(...) so `await tx.insert().values()` works
    // when caller doesn't chain onConflictDoNothing.
    return { tx, inserted };
  }

  function makeService(): VariantAssetLinkService {
    // bypass DI; we only call the static-ish tx methods that don't touch this.db
    const fakeDb: any = { db: {} };
    return new VariantAssetLinkService(fakeDb);
  }

  it('cloneLinksForVariant — source 의 모든 assetId 를 target variantId 로 복제', async () => {
    const service = makeService();
    const { tx, inserted } = makeFakeTx([
      { variantId: 'v-old', assetId: 'a-1' },
      { variantId: 'v-old', assetId: 'a-2' },
    ]);

    await service.cloneLinksForVariant('v-old', 'v-new', tx);

    expect(inserted).toHaveLength(1);
    expect(inserted[0].table).toBe(productVariantDigitalAssetLinks);
    expect(inserted[0].values).toEqual([
      { variantId: 'v-new', assetId: 'a-1' },
      { variantId: 'v-new', assetId: 'a-2' },
    ]);
  });

  it('cloneLinksForVariant — source 가 매칭 없으면 no-op (insert 호출 안 함)', async () => {
    const service = makeService();
    const { tx, inserted } = makeFakeTx([]);

    await service.cloneLinksForVariant('v-old', 'v-new', tx);

    expect(inserted).toHaveLength(0);
  });

  it('inheritLinksFromTwins — 옵션 조합 일치 시 이전 variant 의 asset 매칭을 새 variant 로 인계', async () => {
    const service = makeService();
    const { tx, inserted } = makeFakeTx([
      { variantId: 'prev-twin', assetId: 'a-1' },
      { variantId: 'prev-twin', assetId: 'a-2' },
    ]);

    const inheritedCount = await service.inheritLinksFromTwins(
      [{ newVariantId: 'new-1', previousVariantId: 'prev-twin' }],
      tx,
    );

    expect(inheritedCount).toBe(1);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].values).toEqual([
      { variantId: 'new-1', assetId: 'a-1' },
      { variantId: 'new-1', assetId: 'a-2' },
    ]);
  });

  it('inheritLinksFromTwins — 이전 variant 가 매칭 없으면 그 plan 항목은 건너뛰고 inherited 카운트에서 제외', async () => {
    const service = makeService();
    const { tx, inserted } = makeFakeTx([]);

    const inheritedCount = await service.inheritLinksFromTwins(
      [{ newVariantId: 'new-1', previousVariantId: 'prev-twin-no-links' }],
      tx,
    );

    expect(inheritedCount).toBe(0);
    expect(inserted).toHaveLength(0);
  });

  it('inheritLinksFromTwins — plan 이 빈 배열이면 즉시 0 반환', async () => {
    const service = makeService();
    const { tx, inserted } = makeFakeTx([{ variantId: 'x', assetId: 'a' }]);

    const inheritedCount = await service.inheritLinksFromTwins([], tx);

    expect(inheritedCount).toBe(0);
    expect(inserted).toHaveLength(0);
  });
});
