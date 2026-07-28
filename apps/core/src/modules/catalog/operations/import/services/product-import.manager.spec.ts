jest.mock(
  '@packages/event-contracts',
  () => ({ PRODUCT_STREAM: { topic: { topic: 'products.events.v1' }, aggregateType: 'Product' } }),
  { virtual: true },
);

import { ProductImportManager } from './product-import.manager';
import { ProductRecord, comboKey } from '../dto/import.types';
import { productVariants } from '../../../schema/catalog.schema';

/**
 * 실제 drizzle-orm `eq(column, value)` 가 반환하는 SQL 조각에서 값을 뽑아낸다.
 * product-purchase-constraints.service.spec.ts 의 predicate 파싱 기법과 동일한 방식 —
 * drizzle-orm 자체를 mock 하면 schema.ts 의 module-level pgTable() 호출까지 깨지므로
 * 대신 실제 eq() 가 만든 SQL 조각의 Param chunk 를 읽는다.
 */
function extractEqValue(condition: unknown): unknown {
  const chunks = (condition as { queryChunks?: unknown[] })?.queryChunks;
  if (!Array.isArray(chunks)) return undefined;
  const paramChunk = chunks.find(
    (c) => c && Object.prototype.hasOwnProperty.call(c, 'value') && Object.prototype.hasOwnProperty.call(c, 'encoder'),
  ) as { value?: unknown } | undefined;
  return paramChunk?.value;
}

function validRecord(over: Partial<ProductRecord> = {}): ProductRecord {
  return {
    rowNumber: 1,
    productKey: 'P1',
    raw: { productKey: 'P1', name: '니트' },
    version: { name: '니트' },
    categoryIds: [],
    categoryNames: [],
    options: [],
    variantOverrides: [],
    errors: [],
    ...over,
  };
}

/** 삽입된 아이템을 수집하는 db mock. run(fn) 은 fn(trx) 를 실행; trx.insert 는 values 를 기록. */
function makeHarness(createMasterImpl?: (userId: string) => any) {
  const inserted: any[] = [];
  const sessions: any[] = [];
  const updatedVariantCodes: { variantId: string; variantCode: string }[] = [];
  const trx = {
    insert: (table: any) => ({
      values: (v: any) => {
        (table === 'SESSIONS' ? sessions : inserted).push(v);
        return { returning: () => Promise.resolve([{ ...v, id: 'sess-1' }]) };
      },
    }),
    update: (table: any) => ({
      set: (values: any) => ({
        where: (condition: any) => {
          if (table === productVariants) {
            updatedVariantCodes.push({
              variantId: extractEqValue(condition) as string,
              variantCode: values.variantCode,
            });
          }
          return Promise.resolve();
        },
      }),
    }),
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
    getVariantComboMap: jest.fn(async () => new Map()),
  } as any;
  const pricingService = { replaceVersionRules: jest.fn(async () => ({})) } as any;
  const pricingBuilder = {
    build: jest.fn(() => ({ basePriceRules: [], membershipPriceRules: [], tieredPriceRules: [] })),
  } as any;
  const manager = new ProductImportManager(
    db,
    reader,
    productMastersService,
    productVersionsService,
    pricingService,
    pricingBuilder,
  );
  return {
    manager,
    inserted,
    updatedVariantCodes,
    productMastersService,
    productVersionsService,
    reader,
    pricingService,
    pricingBuilder,
  };
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

  it('variant 생성(updateVersion) 이후에 가격 규칙을 쓴다', async () => {
    const { manager, productMastersService, reader, pricingService } = makeHarness();
    const order: string[] = [];
    productMastersService.updateVersion.mockImplementation(async () => {
      order.push('updateVersion');
      return undefined;
    });
    reader.getVariantComboMap.mockImplementation(async () => {
      order.push('comboMap');
      return new Map();
    });
    pricingService.replaceVersionRules.mockImplementation(async () => {
      order.push('pricing');
      return {};
    });

    await manager.commit({ fileName: 'f.xlsx', userId: 'u1', records: [validRecord()] });

    expect(order).toEqual(['updateVersion', 'comboMap', 'pricing']);
  });

  it('가격 빌더가 만든 규칙을 versionId 와 함께 replaceVersionRules 에 넘긴다', async () => {
    const { manager, pricingService, pricingBuilder, reader } = makeHarness();
    const comboMap = new Map([['색상=빨강', 'var-1']]);
    reader.getVariantComboMap.mockResolvedValue(comboMap);
    const dto = { basePriceRules: [], membershipPriceRules: [], tieredPriceRules: [] };
    pricingBuilder.build.mockReturnValue(dto);

    await manager.commit({ fileName: 'f.xlsx', userId: 'u1', records: [validRecord()] });

    expect(pricingBuilder.build).toHaveBeenCalledWith(expect.objectContaining({ productKey: 'P1' }), comboMap);
    expect(pricingService.replaceVersionRules).toHaveBeenCalledWith('v1', dto, expect.anything());
  });

  it('variantCode 를 조합에 해당하는 variant 에 쓴다', async () => {
    const { manager, reader, updatedVariantCodes } = makeHarness();
    const key = comboKey([{ name: '색상', value: '빨강' }]);
    reader.getVariantComboMap.mockResolvedValue(new Map([[key, 'var-1']]));
    const record = validRecord();
    record.variantOverrides = [
      {
        rowNumber: 1,
        comboKey: key,
        combination: [{ name: '색상', value: '빨강' }],
        basePriceRaw: '',
        membershipPriceRaw: '',
        variantCode: 'KNIT-RD-L',
      },
    ];

    await manager.commit({ fileName: 'f.xlsx', userId: 'u1', records: [record] });

    expect(updatedVariantCodes).toEqual([{ variantId: 'var-1', variantCode: 'KNIT-RD-L' }]);
  });

  it('같은 파일 안에서 variantCode 가 중복되면 그 행을 실패로 만든다', async () => {
    const { manager, reader } = makeHarness();
    const a = comboKey([{ name: '색상', value: '빨강' }]);
    const b = comboKey([{ name: '색상', value: '파랑' }]);
    reader.getVariantComboMap.mockResolvedValue(
      new Map([
        [a, 'var-1'],
        [b, 'var-2'],
      ]),
    );
    const record = validRecord();
    record.variantOverrides = [
      { rowNumber: 1, comboKey: a, combination: [], basePriceRaw: '', membershipPriceRaw: '', variantCode: 'DUP' },
      { rowNumber: 2, comboKey: b, combination: [], basePriceRaw: '', membershipPriceRaw: '', variantCode: 'DUP' },
    ];

    const result = await manager.commit({ fileName: 'f.xlsx', userId: 'u1', records: [record] });

    expect(result.failedCount).toBe(1);
    expect(result.items[0].errorMessage).toMatch(/variantCode/);
  });

  it('같은 파일의 서로 다른 상품끼리 variantCode 가 중복되면 나중 레코드를 실패로 만든다', async () => {
    const { manager, reader, updatedVariantCodes } = makeHarness();
    const a = comboKey([{ name: '색상', value: '빨강' }]);
    // 두 상품 모두 자기 자신의 comboMap 에서는 유효한 variant 로 해석된다(서로 다른 variantId).
    let call = 0;
    reader.getVariantComboMap.mockImplementation(async () => {
      call += 1;
      return call === 1 ? new Map([[a, 'var-1']]) : new Map([[a, 'var-2']]);
    });
    const recordA = validRecord({ productKey: 'A' });
    recordA.variantOverrides = [
      { rowNumber: 1, comboKey: a, combination: [], basePriceRaw: '', membershipPriceRaw: '', variantCode: 'SHARED' },
    ];
    const recordB = validRecord({ productKey: 'B' });
    recordB.variantOverrides = [
      { rowNumber: 1, comboKey: a, combination: [], basePriceRaw: '', membershipPriceRaw: '', variantCode: 'SHARED' },
    ];

    const result = await manager.commit({ fileName: 'f.xlsx', userId: 'u1', records: [recordA, recordB] });

    expect(result.createdCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.items.map((i) => i.status)).toEqual(['created', 'failed']);
    expect(result.items[1].errorMessage).toMatch(/variantCode/);
    expect(updatedVariantCodes).toEqual([{ variantId: 'var-1', variantCode: 'SHARED' }]);
  });

  it('레코드가 variantCode 를 claim 한 뒤 같은 트랜잭션의 다른 단계에서 실패하면, 그 코드는 해제되어 뒤 레코드가 쓸 수 있다', async () => {
    const { manager, reader, pricingService } = makeHarness();
    const a = comboKey([{ name: '색상', value: '빨강' }]);
    let call = 0;
    reader.getVariantComboMap.mockImplementation(async () => {
      call += 1;
      return call === 1 ? new Map([[a, 'var-1']]) : new Map([[a, 'var-2']]);
    });
    // record A 는 applyVariantCodes 까지는 성공(코드를 claim)하지만, 같은 트랜잭션의 뒤 단계
    // (가격 규칙 반영)에서 실패한다 — 이 경우 A 의 트랜잭션 전체가 롤백되므로 claim 도 무효가 되어야 한다.
    pricingService.replaceVersionRules.mockImplementationOnce(async () => {
      throw new Error('가격 규칙 실패');
    });

    const recordA = validRecord({ productKey: 'A' });
    recordA.variantOverrides = [
      { rowNumber: 1, comboKey: a, combination: [], basePriceRaw: '', membershipPriceRaw: '', variantCode: 'REUSED' },
    ];
    const recordB = validRecord({ productKey: 'B' });
    recordB.variantOverrides = [
      { rowNumber: 1, comboKey: a, combination: [], basePriceRaw: '', membershipPriceRaw: '', variantCode: 'REUSED' },
    ];

    const result = await manager.commit({ fileName: 'f.xlsx', userId: 'u1', records: [recordA, recordB] });

    // A 는 가격 규칙 실패로 failed. B 는 A 와 같은 variantCode 를 쓰지만, A 의 claim 은 롤백과
    // 함께 무효화되었어야 하므로 "중복" 으로 튕기지 않고 정상적으로 created 여야 한다.
    // seenVariantCodes 를 applyVariantCodes 내부에서 즉시(eager) 반영하도록 되돌리면 이 테스트가
    // 깨진다 — B 가 잘못된 "파일 안 중복" 오류로 failed 가 된다.
    expect(result.items.map((i) => i.status)).toEqual(['failed', 'created']);
    expect(result.items[0].errorMessage).toMatch(/가격 규칙 실패/);
    expect(result.items[1].errorMessage).toBeUndefined();
  });
});

describe('ProductImportManager.publishSession', () => {
  it('created 아이템의 draft 가 모두 존재하면 전부 publish 한다', async () => {
    const { manager, reader, productVersionsService } = makeHarness();
    reader.getSession.mockResolvedValue({
      items: [{ status: 'created', masterId: 'm1' } as any, { status: 'created', masterId: 'm2' } as any],
    });
    reader.getDraftVersionId.mockResolvedValueOnce('v1').mockResolvedValueOnce('v2');

    const result = await manager.publishSession('sess-1');

    expect(result).toEqual({ published: 2, failed: [] });
    expect(productVersionsService.publishVersion).toHaveBeenCalledTimes(2);
  });

  it('이미 active(draft 없음)인 마스터는 건너뛴다(멱등)', async () => {
    const { manager, reader, productVersionsService } = makeHarness();
    reader.getSession.mockResolvedValue({
      items: [{ status: 'created', masterId: 'm1' } as any, { status: 'created', masterId: 'm2' } as any],
    });
    reader.getDraftVersionId.mockResolvedValueOnce(null).mockResolvedValueOnce('v2');

    const result = await manager.publishSession('sess-1');

    expect(result.published).toBe(1);
    expect(result.failed).toEqual([]);
    expect(productVersionsService.publishVersion).toHaveBeenCalledTimes(1);
  });

  it('한 마스터의 publish 실패가 나머지를 막지 않고 failed 에 수집된다', async () => {
    const { manager, reader, productVersionsService } = makeHarness();
    reader.getSession.mockResolvedValue({
      items: [{ status: 'created', masterId: 'm1' } as any, { status: 'created', masterId: 'm2' } as any],
    });
    reader.getDraftVersionId.mockResolvedValueOnce('v1').mockResolvedValueOnce('v2');
    productVersionsService.publishVersion
      .mockRejectedValueOnce(new Error('가격 미설정'))
      .mockResolvedValueOnce(undefined);

    const result = await manager.publishSession('sess-1');

    expect(result.published).toBe(1);
    expect(result.failed).toEqual([{ masterId: 'm1', reason: '가격 미설정' }]);
  });
});
