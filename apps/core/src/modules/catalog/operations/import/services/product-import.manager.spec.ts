jest.mock(
  '@packages/event-contracts',
  () => ({ PRODUCT_STREAM: { topic: { topic: 'products.events.v1' }, aggregateType: 'Product' } }),
  { virtual: true },
);

import { ProductImportManager } from './product-import.manager';
import { ProductRecord } from '../dto/import.types';

function validRecord(over: Partial<ProductRecord> = {}): ProductRecord {
  return {
    rowNumber: 1,
    productKey: 'P1',
    raw: { productKey: 'P1', name: '니트' },
    version: { name: '니트' },
    categoryIds: [],
    categoryNames: [],
    options: [],
    errors: [],
    ...over,
  };
}

/** 삽입된 아이템을 수집하는 db mock. run(fn) 은 fn(trx) 를 실행; trx.insert 는 values 를 기록. */
function makeHarness(createMasterImpl?: (userId: string) => any) {
  const inserted: any[] = [];
  const sessions: any[] = [];
  const trx = {
    insert: (table: any) => ({
      values: (v: any) => {
        (table === 'SESSIONS' ? sessions : inserted).push(v);
        return { returning: () => Promise.resolve([{ ...v, id: 'sess-1' }]) };
      },
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  };
  // insert 대상 테이블을 태그로 식별하기 위한 매핑 주입
  const db = {
    run: (fn: any, t?: any) => (t ? fn(t) : fn(trx)),
  } as any;
  const productMastersService = {
    createMaster: jest.fn(async (userId: string) =>
      createMasterImpl ? createMasterImpl(userId) : { id: 'v1', masterId: 'm1' },
    ),
    updateVersion: jest.fn(async () => ({ id: 'v1', masterId: 'm1' })),
  } as any;
  const productVersionsService = { publishVersion: jest.fn(async () => undefined) } as any;
  const reader = {
    getSession: jest.fn(),
    getDraftVersionId: jest.fn(),
  } as any;
  const manager = new ProductImportManager(db, reader, productMastersService, productVersionsService);
  return { manager, inserted, productMastersService, productVersionsService, reader };
}

describe('ProductImportManager.commit', () => {
  it('errors 있는 레코드는 create 시도 없이 failed 로 기록한다', async () => {
    const { manager, productMastersService } = makeHarness();
    const bad = validRecord({ productKey: 'BAD', errors: [{ sheet: 'Products', rowNumber: 2, message: 'name 필수' }] });
    const result = await manager.commit({ fileName: 'f.xlsx', userId: 'u1', records: [bad] });

    expect(productMastersService.createMaster).not.toHaveBeenCalled();
    expect(result.failedCount).toBe(1);
    expect(result.createdCount).toBe(0);
    expect(result.items[0]).toMatchObject({ productKey: 'BAD', status: 'failed' });
  });

  it('한 레코드 실패가 나머지를 막지 않는다(행별 격리)', async () => {
    let call = 0;
    const { manager } = makeHarness(() => {
      call += 1;
      if (call === 2) throw new Error('boom');
      return { id: `v${call}`, masterId: `m${call}` };
    });
    const result = await manager.commit({
      fileName: 'f.xlsx',
      userId: 'u1',
      records: [validRecord({ productKey: 'A' }), validRecord({ productKey: 'B' }), validRecord({ productKey: 'C' })],
    });

    expect(result.createdCount).toBe(2);
    expect(result.failedCount).toBe(1);
    expect(result.items.map((i) => i.status)).toEqual(['created', 'failed', 'created']);
  });

  it('createMaster→updateVersion 에 카테고리·optionDiff 를 전달한다', async () => {
    const { manager, productMastersService } = makeHarness();
    await manager.commit({
      fileName: 'f.xlsx',
      userId: 'u1',
      records: [
        validRecord({
          categoryIds: ['c1'],
          primaryCategoryId: 'c1',
          options: [{ displayName: '색상', values: [{ displayName: '빨강' }] }],
        }),
      ],
    });
    expect(productMastersService.updateVersion).toHaveBeenCalledWith(
      'v1',
      expect.objectContaining({
        categoryIds: ['c1'],
        primaryCategoryId: 'c1',
        optionDiff: { add: [{ displayName: '색상', values: [{ displayName: '빨강' }] }] },
      }),
      expect.anything(),
    );
  });
});
