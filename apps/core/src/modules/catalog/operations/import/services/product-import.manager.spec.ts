jest.mock(
  '@packages/event-contracts',
  () => ({ PRODUCT_STREAM: { topic: { topic: 'products.events.v1' }, aggregateType: 'Product' } }),
  { virtual: true },
);

import { PgDialect } from 'drizzle-orm/pg-core';
import { ConflictError, NotFoundError } from '@app/shared';
import { ProductImportManager } from './product-import.manager';
import { ProductRecord, comboKey, EMPTY_SESSION_IMAGES, SessionImageMap } from '../dto/import.types';
import {
  productImportSessions,
  productImportItems,
  productImportImages,
  productVariants,
} from '../../../schema/catalog.schema';

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

/**
 * drizzle sql 조각을 실제 SQL 문자열 + 바인딩 파라미터로 렌더한다.
 * product-import-job.manager.spec.ts 의 renderQuery 와 같은 기법 — where 절이 무엇을
 * 걸렀는지는 values 만 봐서는 알 수 없고 condition 자체를 렌더해야 단정할 수 있다.
 */
function renderQuery(query: unknown): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(query as never);
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

/**
 * drizzle 셀렉트 빌더는 thenable 이면서 `.limit()` 체이닝도 된다. queuePublish 의
 * 두 select 형태(`where(...).limit(1)` 과 `.limit()` 없이 바로 destructure)를 하나로 받는다.
 * `.limit()` 뒤에는 cancelSession 의 `.for('update')` 체이닝도 붙으므로(행 잠금),
 * limit 결과도 thenable 이면서 `.for()` 를 받게 해둔다.
 */
const chain = (rows: any[]): any => {
  const builder: any = Promise.resolve(rows);
  builder.limit = () => {
    const limited: any = Promise.resolve(rows);
    limited.for = () => Promise.resolve(rows);
    return limited;
  };
  return builder;
};

/**
 * 삽입된 아이템을 수집하는 db mock. run(fn) 은 fn(trx) 를 실행; trx.insert 는 values 를 기록.
 *
 * 매 호출이 독립된 목 세트를 만든다 — 한 describe 안의 여러 it 이 같은 jest.fn() 호출
 * 이력을 공유하면 `not.toHaveBeenCalled()` 류 단정이 이전 테스트의 호출을 보고 통과해버려
 * 의미를 잃는다.
 */
function harness(
  createMasterImpl?: (userId: string) => any,
  opts: { session?: Record<string, unknown>; sessionMissing?: boolean } = {},
) {
  const session = opts.sessionMissing
    ? undefined
    : {
        id: 'sess-1',
        commitStatus: 'completed',
        publishStatus: 'idle',
        imageStatus: 'completed',
        cancelRequestedAt: null,
        ...opts.session,
      };
  const inserted: any[] = [];
  const sessions: any[] = [];
  const updatedVariantCodes: { variantId: string; variantCode: string }[] = [];
  const updates: { table: string; values: any; condition: unknown }[] = [];
  const trx = {
    insert: (table: any) => ({
      values: (v: any) => {
        if (table === productImportSessions) sessions.push(v);
        else if (table === productImportItems) inserted.push(...(Array.isArray(v) ? v : [v]));
        return { returning: () => Promise.resolve([{ ...v, id: 'sess-1' }]) };
      },
    }),
    select: (projection?: any) => ({
      from: (table: any) => ({
        // count() 프로젝션이면 집계 한 줄, 아니면 세션 한 줄(없으면 빈 배열)
        where: () =>
          chain(projection?.value ? [{ value: 0 }] : table === productImportSessions && session ? [session] : []),
      }),
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
          updates.push({ table: table === productImportSessions ? 'sessions' : 'items', values, condition });
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
  const reader = {
    getSession: jest.fn(),
    getDraftVersionId: jest.fn(),
    getVariantComboMap: jest.fn(async () => new Map()),
  } as any;
  const pricingService = { replaceVersionRules: jest.fn(async () => ({})) } as any;
  const pricingBuilder = {
    build: jest.fn(() => ({ basePriceRules: [], membershipPriceRules: [], tieredPriceRules: [] })),
  } as any;
  const purchaseConstraintsService = { upsertForDraft: jest.fn(async () => null) } as any;
  // cancelSession 이 트랜잭션 밖에서 무조건 호출한다 — 이 harness 를 쓰는 대부분의 describe
  // 는 cancelSession 을 부르지 않지만, 생성자는 7번째 인자를 요구하므로 여기서 채운다.
  const imageCleaner = { cleanupUploaded: jest.fn().mockResolvedValue(undefined) } as any;
  const manager = new ProductImportManager(
    db,
    reader,
    productMastersService,
    pricingService,
    pricingBuilder,
    purchaseConstraintsService,
    imageCleaner,
  );
  return {
    manager,
    db,
    sessions,
    inserted,
    updatedVariantCodes,
    productMastersService,
    reader,
    pricingService,
    pricingBuilder,
    purchaseConstraintsService,
    imageCleaner,
    updates,
    // createFromRecord 는 이제 tx 를 필수로 받는다. mock trx 는 DbTransaction 의
    // 일부(insert/update)만 흉내내므로, 나머지 harness 값들과 같은 방식으로
    // (`as any`) 넘긴다 — 다른 스펙과 같은 harness 캐스팅 관례다.
    trx: trx as any,
  };
}

describe('acceptCommit', () => {
  it('세션을 queued 로 만들고 유효한 행을 payload 와 함께 pending 으로 적는다', async () => {
    const { manager, sessions, inserted } = harness();

    const result = await manager.acceptCommit({
      fileName: 'f.xlsx',
      userId: 'u1',
      records: [validRecord({ rowNumber: 1, productKey: 'P1' }), validRecord({ rowNumber: 2, productKey: 'P2' })],
    });

    expect(sessions[0]).toMatchObject({ commitStatus: 'queued', publishStatus: 'idle', totalRows: 2, failedCount: 0 });
    expect(inserted).toHaveLength(2);
    expect(inserted[0]).toMatchObject({ rowNumber: 1, productKey: 'P1', status: 'pending' });
    expect(inserted[0].payload).toMatchObject({ productKey: 'P1' });
    expect(result).toEqual({
      sessionId: 'sess-1',
      status: 'queued',
      totalRows: 2,
      queuedCount: 2,
      invalidCount: 0,
      imageCount: 0,
    });
  });

  it('검증 실패 행은 접수 즉시 failed + skipped 로 확정한다 — payload 없이', async () => {
    const { manager, sessions, inserted } = harness();
    const bad = validRecord({
      rowNumber: 1,
      productKey: 'P1',
      errors: [{ sheet: 'Products', rowNumber: 1, message: 'basePrice 는 0보다 커야 합니다' }],
    });

    const result = await manager.acceptCommit({ fileName: 'f.xlsx', userId: 'u1', records: [bad] });

    expect(inserted[0]).toMatchObject({ status: 'failed', publishStatus: 'skipped' });
    expect(inserted[0].payload).toBeUndefined();
    expect(inserted[0].errorMessage).toContain('basePrice');
    expect(sessions[0]).toMatchObject({ failedCount: 1 });
    expect(result).toMatchObject({ queuedCount: 0, invalidCount: 1 });
  });

  it('상품을 만들지 않는다 — 그건 워커의 몫이다', async () => {
    const { manager, productMastersService } = harness();

    await manager.acceptCommit({ fileName: 'f.xlsx', userId: 'u1', records: [validRecord()] });

    expect(productMastersService.createMaster).not.toHaveBeenCalled();
  });

  it('접수 시점 검증실패 수를 invalidCount 로 얼려 둔다 — failedCount 는 나중에 생성실패와 섞인다', async () => {
    const { manager, sessions } = harness();
    const bad = validRecord({
      rowNumber: 3,
      productKey: 'P3',
      errors: [{ sheet: 'Products', rowNumber: 3, message: '상품명이 없습니다' }],
    });

    await manager.acceptCommit({ fileName: 'f.xlsx', userId: 'u1', records: [validRecord(), bad] });

    // failedCount 와 invalidCount 는 접수 시점에는 같은 값이지만, 이후 failItem 이
    // failedCount 만 올리므로 갈라진다. 그 갈라짐을 복원하려고 얼려 두는 값이다.
    expect(sessions[0]).toMatchObject({ totalRows: 2, failedCount: 1, invalidCount: 1 });
  });
});

describe('ProductImportManager.acceptCommit — 이미지', () => {
  /** insert 대상 테이블별로 values() 인자를 모으는 최소 트랜잭션 목. */
  function harness() {
    const inserted = new Map<unknown, unknown[]>();
    const trx = {
      insert: (table: unknown) => ({
        values: (rows: unknown) => {
          const list = inserted.get(table) ?? [];
          list.push(...(Array.isArray(rows) ? rows : [rows]));
          inserted.set(table, list);
          return {
            returning: () => Promise.resolve([{ id: 'session-1' }]),
            then: (resolve: (v: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
          };
        },
      }),
    };
    const db = { run: (fn: (t: unknown) => Promise<unknown>) => fn(trx) } as never;
    return { inserted, db };
  }

  /**
   * acceptCommit 은 협력자를 **하나도 부르지 않는다** — 세션과 행을 적을 뿐이다.
   * 목을 채우는 대신 undefined 로 두면, 나중에 누가 여기서 협력자를 부르도록 바꿨을 때
   * 이 테스트가 TypeError 로 즉시 알려준다.
   * 순서: reader, productMastersService, pricingService, pricingBuilder, purchaseConstraintsService, imageCleaner.
   */
  const COLLABORATORS = [
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
  ] as const;

  function record(over: Partial<ProductRecord>): ProductRecord {
    return {
      rowNumber: 1,
      productKey: 'P1',
      raw: { productKey: 'P1', name: 'x', basePrice: '1000' },
      version: { name: 'x' },
      basePrice: 1000,
      categoryIds: [],
      categoryNames: [],
      options: [],
      variantOverrides: [],
      errors: [],
      ...over,
    };
  }

  const REF_MAIN = { imageKey: 'IMG-1', usage: 'main' as const, sourceUrl: 'https://e.example/1.jpg' };
  const REF_DESC = { imageKey: 'IMG-1', usage: 'description' as const, sourceUrl: 'https://e.example/1.jpg' };

  it('이미지가 없으면 커밋 레인이 바로 queued 이고 image 레인은 completed 다', async () => {
    const { inserted, db } = harness();
    const manager = new ProductImportManager(db, ...COLLABORATORS);

    const out = await manager.acceptCommit({ fileName: 'a.xlsx', userId: 'u-1', records: [record({})] });

    expect(out.imageCount).toBe(0);
    expect(inserted.get(productImportImages)).toBeUndefined();
    const [session] = inserted.get(productImportSessions) as Array<Record<string, unknown>>;
    expect(session.commitStatus).toBe('queued');
    expect(session.imageStatus).toBe('completed');
  });

  it('이미지가 있으면 커밋 레인을 idle 로 게이트하고 image 레인을 queued 로 둔다', async () => {
    const { inserted, db } = harness();
    const manager = new ProductImportManager(db, ...COLLABORATORS);
    const out = await manager.acceptCommit({
      fileName: 'a.xlsx',
      userId: 'u-1',
      records: [record({ imageRefs: [REF_MAIN] })],
    });

    expect(out.imageCount).toBe(1);
    const [session] = inserted.get(productImportSessions) as Array<Record<string, unknown>>;
    expect(session.commitStatus).toBe('idle');
    expect(session.imageStatus).toBe('queued');
  });

  it('여러 상품이 같은 (키, 용도) 를 가리키면 이미지 행은 하나다', async () => {
    const { inserted, db } = harness();
    const manager = new ProductImportManager(db, ...COLLABORATORS);
    await manager.acceptCommit({
      fileName: 'a.xlsx',
      userId: 'u-1',
      records: [
        record({ rowNumber: 1, productKey: 'P1', imageRefs: [REF_MAIN] }),
        record({ rowNumber: 2, productKey: 'P2', imageRefs: [REF_MAIN] }),
      ],
    });
    expect(inserted.get(productImportImages)).toHaveLength(1);
  });

  it('같은 키가 용도가 다르면 행이 둘이다', async () => {
    const { inserted, db } = harness();
    const manager = new ProductImportManager(db, ...COLLABORATORS);
    await manager.acceptCommit({
      fileName: 'a.xlsx',
      userId: 'u-1',
      records: [record({ imageRefs: [REF_MAIN, REF_DESC] })],
    });
    const rows = inserted.get(productImportImages) as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.usage).sort()).toEqual(['description', 'main']);
  });

  it('오류 있는 행의 이미지는 내려받지 않는다', async () => {
    const { inserted, db } = harness();
    const manager = new ProductImportManager(db, ...COLLABORATORS);
    const out = await manager.acceptCommit({
      fileName: 'a.xlsx',
      userId: 'u-1',
      records: [
        record({
          imageRefs: [REF_MAIN],
          errors: [{ sheet: 'Products', rowNumber: 1, message: 'name 은 필수입니다.' }],
        }),
      ],
    });
    expect(out.imageCount).toBe(0);
    expect(inserted.get(productImportImages)).toBeUndefined();
    const [session] = inserted.get(productImportSessions) as Array<Record<string, unknown>>;
    // 내려받을 이미지가 없으므로 게이트도 걸지 않는다
    expect(session.commitStatus).toBe('queued');
  });
});

describe('createFromRecord', () => {
  // per-row 실패 격리(터진 행이 나머지를 막지 않는지)는 여기서 다시 테스트하지 않는다 —
  // 그 격리는 createFromRecord 자체가 아니라 호출자인 ProductImportJobManager.runCommitSlice
  // 의 for-loop try/catch 에 있는 성질이라, product-import-job.manager.spec.ts 의
  // '한 행이 터져도 나머지를 계속 처리하고 그 행만 failed 로 남긴다' 테스트가 이미 그
  // 실제 동작(단, createFromRecord 는 mock)을 슬라이스 단위로 단정한다. 여기서 같은
  // 이름의 테스트를 또 만들면 같은 사실을 두 번 주장하는 것뿐이다.

  it('createMaster→updateVersion 에 카테고리·optionDiff 를 전달한다', async () => {
    const { manager, productMastersService, trx } = harness();

    await manager.createFromRecord(
      validRecord({
        categoryIds: ['c1'],
        primaryCategoryId: 'c1',
        options: [{ displayName: '색상', values: [{ displayName: '빨강' }], sortOrder: 1 }],
      }),
      'u1',
      trx,
      EMPTY_SESSION_IMAGES,
    );

    expect(productMastersService.updateVersion).toHaveBeenCalledWith(
      'v1',
      expect.objectContaining({
        categoryIds: ['c1'],
        primaryCategoryId: 'c1',
        optionDiff: { add: [{ displayName: '색상', values: [{ displayName: '빨강' }], sortOrder: 1 }] },
      }),
      expect.anything(),
    );
  });

  it('options 가 없으면 optionDiff 는 undefined 다', async () => {
    const { manager, productMastersService, trx } = harness();

    await manager.createFromRecord(validRecord({ options: [] }), 'u1', trx, EMPTY_SESSION_IMAGES);

    const [, data] = productMastersService.updateVersion.mock.calls[0];
    expect(data.optionDiff).toBeUndefined();
  });

  it('variantOverrides 가 없으면 getVariantComboMap 을 호출하지 않는다 (#4 최적화)', async () => {
    // variant 마다 4-join 조회를 도는 getVariantComboMap 은 Variants 시트를 안 쓴
    // 파일(v1 호환 경로)에서 비용을 물지 않아야 한다 — product-import.manager.ts 의
    // createFromRecord 가드(variantOverrides.length > 0 일 때만 호출).
    const { manager, reader, trx } = harness();

    await manager.createFromRecord(validRecord({ variantOverrides: [] }), 'u1', trx, EMPTY_SESSION_IMAGES);

    expect(reader.getVariantComboMap).not.toHaveBeenCalled();
  });

  it('updateVersion → comboMap 조회 → 가격 규칙 쓰기 순서로 진행한다', async () => {
    const { manager, productMastersService, reader, pricingService, trx } = harness();
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
    const record = validRecord({
      variantOverrides: [{ rowNumber: 1, comboKey: '색상=빨강', basePriceRaw: '', membershipPriceRaw: '' }],
    });

    await manager.createFromRecord(record, 'u1', trx, EMPTY_SESSION_IMAGES);

    expect(order).toEqual(['updateVersion', 'comboMap', 'pricing']);
  });

  it('가격 빌더가 만든 규칙을 versionId·comboMap 과 함께 replaceVersionRules 에 넘긴다', async () => {
    const { manager, pricingService, pricingBuilder, reader, trx } = harness();
    const comboMap = new Map([['색상=빨강', 'var-1']]);
    reader.getVariantComboMap.mockResolvedValue(comboMap);
    const dto = { basePriceRules: [], membershipPriceRules: [], tieredPriceRules: [] };
    pricingBuilder.build.mockReturnValue(dto);
    const record = validRecord({
      variantOverrides: [{ rowNumber: 1, comboKey: '색상=빨강', basePriceRaw: '', membershipPriceRaw: '' }],
    });

    await manager.createFromRecord(record, 'u1', trx, EMPTY_SESSION_IMAGES);

    expect(pricingBuilder.build).toHaveBeenCalledWith(expect.objectContaining({ productKey: 'P1' }), comboMap);
    expect(pricingService.replaceVersionRules).toHaveBeenCalledWith('v1', dto, expect.anything());
  });

  it('variantCode 를 조합에 해당하는 variant 에 쓴다', async () => {
    const { manager, reader, updatedVariantCodes, trx } = harness();
    const key = comboKey([{ name: '색상', value: '빨강' }]);
    reader.getVariantComboMap.mockResolvedValue(new Map([[key, 'var-1']]));
    const record = validRecord();
    record.variantOverrides = [
      {
        rowNumber: 1,
        comboKey: key,
        basePriceRaw: '',
        membershipPriceRaw: '',
        variantCode: 'KNIT-RD-L',
      },
    ];

    await manager.createFromRecord(record, 'u1', trx, EMPTY_SESSION_IMAGES);

    expect(updatedVariantCodes).toEqual([{ variantId: 'var-1', variantCode: 'KNIT-RD-L' }]);
  });
});

describe('createFromRecord — v3 3단계 필드', () => {
  function baseRecord(): ProductRecord {
    return {
      rowNumber: 1,
      productKey: 'P1',
      raw: { productKey: 'P1', name: '니트A' },
      version: { name: '니트A', seoTitle: '겨울 니트', seoKeywords: ['니트', '겨울'], isWholesaleOnly: true },
      basePrice: 29000,
      categoryIds: ['c-knit', 'c-event'],
      categoryNames: ['여성패션', '니트'],
      primaryCategoryId: 'c-knit',
      options: [],
      variantOverrides: [],
      errors: [],
    };
  }

  it('다중 카테고리와 대표 카테고리를 updateVersion 에 넘긴다', async () => {
    const { manager, productMastersService } = harness();
    await manager.createFromRecord(baseRecord(), 'u1', {} as any, EMPTY_SESSION_IMAGES);

    const [, data] = productMastersService.updateVersion.mock.calls[0];
    expect(data.categoryIds).toEqual(['c-knit', 'c-event']);
    expect(data.primaryCategoryId).toBe('c-knit');
    expect(data.seoKeywords).toEqual(['니트', '겨울']);
    expect(data.isWholesaleOnly).toBe(true);
  });

  it('ISO 문자열 판매기간을 Date 로 되살려 넘긴다', async () => {
    const { manager, productMastersService } = harness();
    const record = baseRecord();
    // 워커는 항상 jsonb 왕복을 거친 값을 본다 — 그 형태를 그대로 재현한다
    record.salesStartDate = '2026-07-31T15:00:00.000Z';
    record.salesEndDate = '2026-08-31T14:59:59.999Z';

    await manager.createFromRecord(record, 'u1', {} as any, EMPTY_SESSION_IMAGES);

    const [, data] = productMastersService.updateVersion.mock.calls[0];
    expect(data.salesStartDate).toBeInstanceOf(Date);
    expect((data.salesStartDate as Date).toISOString()).toBe('2026-07-31T15:00:00.000Z');
    expect((data.salesEndDate as Date).toISOString()).toBe('2026-08-31T14:59:59.999Z');
  });

  it('판매기간이 없으면 키 자체를 넣지 않는다 (기존 값을 null 로 덮지 않는다)', async () => {
    const { manager, productMastersService } = harness();
    await manager.createFromRecord(baseRecord(), 'u1', {} as any, EMPTY_SESSION_IMAGES);

    const [, data] = productMastersService.updateVersion.mock.calls[0];
    expect('salesStartDate' in data).toBe(false);
    expect('salesEndDate' in data).toBe(false);
  });

  it('구매제약이 있으면 draft 에 upsert 한다', async () => {
    const { manager, purchaseConstraintsService } = harness();
    const record = baseRecord();
    record.purchaseConstraint = { requiresMembership: true, lifetimeQuantityLimit: 2 };

    await manager.createFromRecord(record, 'u1', {} as any, EMPTY_SESSION_IMAGES);

    expect(purchaseConstraintsService.upsertForDraft).toHaveBeenCalledWith(
      'm1',
      'v1',
      { requiresMembership: true, lifetimeQuantityLimit: 2 },
      expect.anything(),
    );
  });

  it('구매제약이 없으면 아예 호출하지 않는다', async () => {
    const { manager, purchaseConstraintsService } = harness();
    await manager.createFromRecord(baseRecord(), 'u1', {} as any, EMPTY_SESSION_IMAGES);
    expect(purchaseConstraintsService.upsertForDraft).not.toHaveBeenCalled();
  });
});

describe('ProductImportManager.createFromRecord — 이미지', () => {
  /** updateVersion 이 받은 data 를 캡처한다. 나머지 협력자는 최소 동작만. */
  function capture() {
    const updates: Array<Record<string, unknown>> = [];
    const productMastersService = {
      createMaster: jest.fn().mockResolvedValue({ id: 'v-1', masterId: 'm-1' }),
      updateVersion: jest.fn(async (_versionId: string, data: Record<string, unknown>) => {
        updates.push(data);
      }),
    };
    const manager = new ProductImportManager(
      { run: <T>(fn: (t: unknown) => Promise<T>) => fn({}) } as never,
      { getVariantComboMap: jest.fn().mockResolvedValue(new Map()) } as never,
      productMastersService as never,
      { replaceVersionRules: jest.fn() } as never,
      { build: jest.fn().mockReturnValue([]) } as never,
      { upsertForDraft: jest.fn() } as never,
      undefined as never,
    );
    return { manager, updates };
  }

  function record(over: Partial<ProductRecord>): ProductRecord {
    return {
      rowNumber: 1,
      productKey: 'P1',
      raw: {},
      version: { name: '니트A' },
      basePrice: 29000,
      categoryIds: [],
      categoryNames: [],
      options: [],
      variantOverrides: [],
      errors: [],
      ...over,
    };
  }

  const images: SessionImageMap = {
    main: new Map([
      ['IMG-1', 'f-thumb'],
      ['IMG-2', 'f-add-2'],
      ['IMG-3', 'f-add-3'],
    ]),
    description: new Map([['IMG-9', 'f-desc']]),
  };

  it('대표·부가 fileId 를 updateVersion 에 넘긴다', async () => {
    const { manager, updates } = capture();
    await manager.createFromRecord(
      record({ thumbnailImageKey: 'IMG-1', additionalImageKeys: ['IMG-2'] }),
      'u-1',
      {} as never,
      images,
    );
    expect(updates[0]).toMatchObject({ thumbnailFileId: 'f-thumb', additionalImageFileIds: ['f-add-2'] });
  });

  it('부가 이미지 순서가 지정 순서 그대로다 (updateVersion 이 index+1 을 sortOrder 로 쓴다)', async () => {
    const { manager, updates } = capture();
    await manager.createFromRecord(record({ additionalImageKeys: ['IMG-3', 'IMG-2'] }), 'u-1', {} as never, images);
    expect(updates[0].additionalImageFileIds).toEqual(['f-add-3', 'f-add-2']);
  });

  it('본문 디렉티브의 imageKey 를 fileId 로 치환한다', async () => {
    const { manager, updates } = capture();
    await manager.createFromRecord(
      record({
        version: { name: 'x', description: '앞\n::product-image{imageKey="IMG-9" alt="상세"}' },
        descriptionImageKeys: ['IMG-9'],
      }),
      'u-1',
      {} as never,
      images,
    );
    expect(updates[0].description).toBe('앞\n::product-image{fileId="f-desc" alt="상세"}');
  });

  it('이미지를 안 쓰는 행은 이미지 키를 아예 만들지 않는다', async () => {
    const { manager, updates } = capture();
    await manager.createFromRecord(record({}), 'u-1', {} as never, EMPTY_SESSION_IMAGES);
    // undefined 를 넣어도 drizzle 은 무시하지만, 키를 만들면 updateVersion 이
    // `!== undefined` 분기로 기존 이미지를 지우는 DELETE 두 번을 더 돈다.
    expect('thumbnailFileId' in updates[0]).toBe(false);
    expect('additionalImageFileIds' in updates[0]).toBe(false);
  });
});

describe('queuePublish', () => {
  it('publish_status 를 queued 로 올리고 실패했던 행만 pending 으로 되돌린다', async () => {
    const { manager, updates } = harness();

    const result = await manager.queuePublish('sess-1');

    expect(result).toMatchObject({ sessionId: 'sess-1', status: 'queued' });
    const sessionUpdate = updates.find((u) => u.values.publishStatus === 'queued');
    expect(sessionUpdate).toBeDefined();
    const retry = updates.find((u) => u.values.publishStatus === 'pending');
    expect(retry).toBeDefined();
    // eq(publishStatus, 'failed') 가 빠지면 이 update 는 모든 아이템(이미 published 인
    // 행 포함)을 pending 으로 되돌린다 — 이미 게시된 상품이 다시 게시 대상이 되어
    // 이벤트가 두 번 나간다(이 메서드의 doc 주석이 경고하는 바로 그 위험). values 만
    // 보면 그 회귀가 안 보이므로 where 절 자체를 렌더링해 술어를 단정한다.
    const { sql, params } = renderQuery(retry!.condition);
    expect(sql.toLowerCase()).toMatch(/"publish_status"\s*=/);
    expect(params).toContain('failed');
  });

  it('이미 running 이면 409 다', async () => {
    const { manager } = harness(undefined, { session: { publishStatus: 'running' } });

    await expect(manager.queuePublish('sess-1')).rejects.toThrow(/이미/);
  });

  it('commit 이 끝나지 않았으면 409 다', async () => {
    const { manager } = harness(undefined, { session: { commitStatus: 'running', publishStatus: 'idle' } });

    await expect(manager.queuePublish('sess-1')).rejects.toThrow(/생성/);
  });

  it('취소된 세션은 다시 게시할 수 없다 — 재개하려면 워크북을 재업로드한다', async () => {
    const { manager } = harness(undefined, {
      session: { commitStatus: 'completed', publishStatus: 'canceled', cancelRequestedAt: new Date() },
    });

    await expect(manager.queuePublish('sess-1')).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('cancelSession', () => {
  it('진행 중인 레인만 canceled 로 확정하고 끝난 레인은 그대로 둔다', async () => {
    const { manager, updates } = harness(undefined, {
      session: { commitStatus: 'completed', publishStatus: 'running' },
    });

    const res = await manager.cancelSession('sess-1');

    // commit 은 실제로 끝났다 — 상품이 생성됐는데 canceled 로 덮으면 이력이 거짓이 된다.
    expect(res).toMatchObject({ sessionId: 'sess-1', commitStatus: 'completed', publishStatus: 'canceled' });
    const sessionUpdates = updates.filter((u) => u.table === 'sessions');
    expect(sessionUpdates).toHaveLength(1);
    expect(sessionUpdates[0].values.publishStatus).toBe('canceled');
    expect(sessionUpdates[0].values.commitStatus).toBeUndefined();
    expect(sessionUpdates[0].values.cancelRequestedAt).toBeInstanceOf(Date);
  });

  it('queued 인 레인도 취소 대상이다 — 아직 시작 안 한 게시를 막을 수 있어야 한다', async () => {
    const { manager, updates } = harness(undefined, {
      session: { commitStatus: 'completed', publishStatus: 'queued' },
    });

    await manager.cancelSession('sess-1');

    expect(updates.filter((u) => u.table === 'sessions')[0].values.publishStatus).toBe('canceled');
  });

  it('lease 를 지우지 않는다 — 진행 중 워커가 renewLease 로 취소를 읽고 스스로 멈춰야 한다', async () => {
    const { manager, updates } = harness(undefined, {
      session: { commitStatus: 'running', publishStatus: 'idle' },
    });

    await manager.cancelSession('sess-1');

    const values = updates.filter((u) => u.table === 'sessions')[0].values;
    expect(values.leaseToken).toBeUndefined();
    expect(values.leaseUntil).toBeUndefined();
  });

  it('진행 중인 레인이 없으면 취소할 것이 없다', async () => {
    const { manager } = harness(undefined, {
      session: { commitStatus: 'completed', publishStatus: 'completed' },
    });

    await expect(manager.cancelSession('sess-1')).rejects.toBeInstanceOf(ConflictError);
  });

  it('이미 취소된 세션은 다시 취소되지 않는다 — 취소는 종단이다', async () => {
    const { manager } = harness(undefined, {
      session: { commitStatus: 'canceled', publishStatus: 'idle', cancelRequestedAt: new Date() },
    });

    await expect(manager.cancelSession('sess-1')).rejects.toBeInstanceOf(ConflictError);
  });

  it('없는 세션은 404 다', async () => {
    const { manager } = harness(undefined, { sessionMissing: true });

    await expect(manager.cancelSession('nope')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('failed 레인도 취소 대상이다 — 연속 실패 상한에 닿아 굳은 세션도 취소로 풀 수 있어야 한다', async () => {
    const { manager, updates, imageCleaner } = harness(undefined, {
      session: { commitStatus: 'failed', publishStatus: 'idle' },
    });

    const res = await manager.cancelSession('sess-1');

    expect(res).toMatchObject({ commitStatus: 'canceled' });
    const sessionUpdates = updates.filter((u) => u.table === 'sessions');
    expect(sessionUpdates[0].values.commitStatus).toBe('canceled');
    // failed 확정으로 굳은 세션도 이미지 정리 경로가 열려야 한다(§finding1).
    expect(imageCleaner.cleanupUploaded).toHaveBeenCalledWith('sess-1');
  });
});

describe('ProductImportManager.cancelSession — 이미지 레인', () => {
  function harness(session: Record<string, unknown>) {
    const updates: Array<Record<string, unknown>> = [];
    const cleanupUploaded = jest.fn().mockResolvedValue(undefined);
    const trx = {
      select: () => ({
        from: () => ({ where: () => ({ limit: () => ({ for: () => Promise.resolve([session]) }) }) }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => {
          updates.push(values);
          return { where: () => Promise.resolve() };
        },
      }),
    };
    const manager = new ProductImportManager(
      { run: <T>(fn: (t: unknown) => Promise<T>) => fn(trx) } as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      { cleanupUploaded } as never,
    );
    return { manager, updates, cleanupUploaded };
  }

  const RUNNING_IMAGE = {
    id: 's-1',
    imageStatus: 'running',
    // 이미지 레인이 도는 동안 커밋 레인은 게이트 때문에 'idle' 이다(acceptCommit).
    commitStatus: 'idle',
    publishStatus: 'idle',
    cancelRequestedAt: null,
  };

  it('이미지 레인만 진행 중이어도 취소된다', async () => {
    const { manager, updates } = harness(RUNNING_IMAGE);
    const out = await manager.cancelSession('s-1');

    expect(updates[0]).toMatchObject({ imageStatus: 'canceled' });
    expect(updates[0].cancelRequestedAt).toBeInstanceOf(Date);
    // 끝나지 않은(아직 시작도 안 한) 레인은 덮지 않는다 — 이력이 거짓이 되지 않게.
    expect('commitStatus' in updates[0]).toBe(false);
    expect('publishStatus' in updates[0]).toBe(false);
    expect(out).toMatchObject({ imageStatus: 'canceled', commitStatus: 'idle', publishStatus: 'idle' });
  });

  it('취소 후 업로드된 이미지를 정리한다', async () => {
    const { manager, cleanupUploaded } = harness(RUNNING_IMAGE);
    await manager.cancelSession('s-1');
    expect(cleanupUploaded).toHaveBeenCalledWith('s-1');
  });

  it('정리가 실패해도 취소 응답은 정상이다', async () => {
    const { manager, cleanupUploaded } = harness(RUNNING_IMAGE);
    cleanupUploaded.mockRejectedValue(new Error('file-service 다운'));
    // 취소가 정리 때문에 실패하는 편이 더 나쁘다.
    await expect(manager.cancelSession('s-1')).resolves.toMatchObject({ imageStatus: 'canceled' });
  });

  it('진행 중인 레인이 하나도 없으면 409 (이미지 레인까지 포함해 판정)', async () => {
    const { manager, cleanupUploaded } = harness({
      id: 's-1',
      imageStatus: 'completed',
      commitStatus: 'completed',
      publishStatus: 'completed',
      cancelRequestedAt: null,
    });
    await expect(manager.cancelSession('s-1')).rejects.toBeInstanceOf(ConflictError);
    expect(cleanupUploaded).not.toHaveBeenCalled();
  });

  it('이미지 레인이 failed 여도 취소 대상이다 — 굳은 세션을 취소로 푸는 유일한 경로다', async () => {
    const { manager, updates, cleanupUploaded } = harness({
      id: 's-1',
      imageStatus: 'failed',
      commitStatus: 'idle',
      publishStatus: 'idle',
      cancelRequestedAt: null,
    });

    const out = await manager.cancelSession('s-1');

    expect(updates[0]).toMatchObject({ imageStatus: 'canceled' });
    // idle 인 커밋·게시 레인은 여전히 건드리지 않는다 — active() 판정 대상이 아니다.
    expect('commitStatus' in updates[0]).toBe(false);
    expect('publishStatus' in updates[0]).toBe(false);
    expect(cleanupUploaded).toHaveBeenCalledWith('s-1');
    expect(out).toMatchObject({ imageStatus: 'canceled' });
  });
});
