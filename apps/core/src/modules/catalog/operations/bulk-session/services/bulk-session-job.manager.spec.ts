import { Logger } from '@nestjs/common';
import { BadRequestError } from '@app/shared';
import { PgDialect } from 'drizzle-orm/pg-core';
import { productBulkSessions, productBulkItems, productBulkImages } from '../../../schema/catalog.schema';
import { BulkSessionJobManager, MAX_CONSECUTIVE_BULK_FAILURES } from './bulk-session-job.manager';
import type { ParsedUpload, RawSheetRow } from './bulk-upload.parser';
import type { PrefillBundle } from './form-export.types';
import { PRICING_SENTINEL } from './form-export.sheets';
import { isBulkItemPayload, type BulkItemInput } from './bulk-session.types';

// 파서만 목으로 둔다 — 파일 경계(실제 xlsx 버퍼)를 만드는 일은 Task 4 의 스위트가 이미
// 검증했고, 여기서 보려는 것은 그 결과를 매니저가 어떻게 적재·검증하는지다. 접합기·검증기·
// 평면맵·diff 는 **목이 아니라 실제 구현**이 돈다.
jest.mock('./bulk-upload.parser', () => ({
  ...jest.requireActual<Record<string, unknown>>('./bulk-upload.parser'),
  parseUploadWorkbook: jest.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const parserModule = require('./bulk-upload.parser') as {
  parseUploadWorkbook: jest.Mock<Promise<ParsedUpload>, unknown[]>;
};

/**
 * drizzle 조건절을 실제 SQL 문자열 + 바인딩 값으로 렌더한다. CAS 가 "아무 값"이 아니라
 * **정확히 기대한 토큰**과 비교하는지는 조건절 문자열만으로는 단정할 수 없다(플레이스홀더
 * `$n` 만 보이므로) — form-export-job.manager.spec.ts 와 같은 기법이다.
 */
function renderQuery(query: unknown): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(query as never);
}

type FakeRow = Record<string, unknown>;

/** drizzle 셀렉트 빌더는 thenable 이면서 where/orderBy/limit 이 체이닝된다. */
interface SelectChain extends Promise<FakeRow[]> {
  where(condition?: unknown): SelectChain;
  orderBy(...columns: unknown[]): SelectChain;
  limit(n?: number): SelectChain;
}

function selectChain(rows: FakeRow[]): SelectChain {
  // Promise 인스턴스에 체이너를 얹어 thenable+체이너블 양쪽을 만족시킨다 — 이 형태 자체가
  // 실제 drizzle 빌더 타입과 구조적으로 다르므로 캐스팅이 불가피하다.
  const builder = Promise.resolve(rows) as SelectChain;
  builder.where = () => builder;
  builder.orderBy = () => builder;
  builder.limit = () => builder;
  return builder;
}

/** update().set().where() 는 그대로 await 되기도 하고 `.returning()` 이 붙기도 한다. */
interface UpdateChain extends Promise<void> {
  returning(): Promise<FakeRow[]>;
}

interface FakeTrx {
  execute: jest.Mock<Promise<FakeRow[]>, unknown[]>;
  select: (fields?: unknown) => { from: (table: unknown) => SelectChain };
  insert: (table: unknown) => { values: (values: unknown) => Promise<void> };
  update: (table: unknown) => { set: (values: FakeRow) => { where: (condition?: unknown) => UpdateChain } };
}

const EMPTY_PRESENT: BulkItemInput['present'] = {
  products: [],
  options: [],
  variants: [],
  categories: [],
  constraints: [],
};

const PRODUCT_KEYS = [
  'rowKey',
  'name',
  'basePrice',
  'membershipPrice',
  'thumbnailImageKey',
  'additionalImageKeys',
  'brand',
];

function parsedUpload(overrides: Partial<ParsedUpload> = {}): ParsedUpload {
  return {
    exportId: null,
    sheets: { products: [], options: [], variants: [], categories: [], constraints: [], images: [] },
    present: {
      products: new Set(PRODUCT_KEYS),
      options: new Set<string>(),
      variants: new Set<string>(),
      categories: new Set<string>(),
      constraints: new Set<string>(),
    },
    ...overrides,
  };
}

function productRow(rowNumber: number, cells: Record<string, string>): RawSheetRow {
  return { rowNumber, cells };
}

function snapshotOf(overrides: Partial<PrefillBundle> = {}): PrefillBundle {
  return {
    product: { name: '기존 상품', basePrice: '10000', membershipPrice: '', brand: '기존브랜드' },
    options: [],
    variants: [],
    categories: [],
    constraint: null,
    images: {},
    ...overrides,
  };
}

interface HarnessOpts {
  claimed?: FakeRow[];
  sessionRow?: FakeRow | null;
  exportItems?: FakeRow[];
  bulkItems?: FakeRow[];
  bulkImages?: FakeRow[];
  /** 파싱 슬라이스 마감 CAS 가 소유권을 유지했는지. false 면 0행(레이스에서 짐)을 흉내낸다. */
  finalizeOwned?: boolean;
  /** renewLease 의 반환. 빈 배열이면 소유권 상실, cancelRequestedAt 이 있으면 취소. */
  renewRows?: FakeRow[];
  /** recordJobError 의 `returning` 이 돌려줄 누적 연속 실패 횟수. 상한 분기를 태우려면 올린다. */
  failures?: number;
  renderMasterResult?: (PrefillBundle & { versionId: string }) | null;
  categoryTree?: { categories: Array<{ id: string; name: string; isActive: boolean; children?: [] }> };
  downloadError?: Error;
}

function makeHarness(opts: HarnessOpts = {}) {
  const updates: Array<{ table: string; values: FakeRow; condition?: unknown }> = [];
  const inserts: Array<{ table: string; values: FakeRow[] }> = [];

  const tableName = (table: unknown): string => {
    if (table === productBulkSessions) return 'sessions';
    if (table === productBulkItems) return 'items';
    if (table === productBulkImages) return 'images';
    return 'other';
  };

  const rowsFor = (table: unknown): FakeRow[] => {
    if (table === productBulkSessions) {
      const session = opts.sessionRow === undefined ? { ...SESSION_ROW } : opts.sessionRow;
      return session ? [session] : [];
    }
    if (table === productBulkItems) return opts.bulkItems ?? [];
    if (table === productBulkImages) return opts.bulkImages ?? [];
    return opts.exportItems ?? [];
  };

  const trx: FakeTrx = {
    execute: jest.fn(() => Promise.resolve(opts.claimed ?? [])),
    select: () => ({ from: (table) => selectChain(rowsFor(table)) }),
    insert: (table) => ({
      values: (values) => {
        inserts.push({ table: tableName(table), values: values as FakeRow[] });
        return Promise.resolve();
      },
    }),
    update: (table) => ({
      set: (values) => ({
        where: (condition): UpdateChain => {
          updates.push({ table: tableName(table), values, condition });
          const result = Promise.resolve() as UpdateChain;
          result.returning = () => {
            // renewLease 만 leaseUntil 하나를 set 한다 — 마감/실패 CAS 와 구분되는 표시다.
            if (Object.keys(values).length === 1 && 'leaseUntil' in values) {
              return Promise.resolve(opts.renewRows ?? [{ cancelRequestedAt: null }]);
            }
            // 파싱 마감 CAS / recordJobError.
            if (values.phase === 'validating') {
              return Promise.resolve(opts.finalizeOwned === false ? [] : [{ id: 'sess-1' }]);
            }
            return Promise.resolve([{ failures: opts.failures ?? 1 }]);
          };
          return result;
        },
      }),
    }),
  };

  const db = { run: <T>(fn: (t: FakeTrx) => Promise<T>) => fn(trx) };
  const download: jest.Mock<Promise<Buffer>, unknown[]> = jest.fn(() =>
    opts.downloadError ? Promise.reject(opts.downloadError) : Promise.resolve(Buffer.from('xlsx')),
  );
  const renderMaster: jest.Mock<Promise<(PrefillBundle & { versionId: string }) | null>, unknown[]> = jest.fn(() =>
    Promise.resolve(
      opts.renderMasterResult === undefined ? { ...snapshotOf(), versionId: 'v1' } : opts.renderMasterResult,
    ),
  );
  const getCategoryTree = jest.fn(() => Promise.resolve(opts.categoryTree ?? { categories: [] }));
  const config = { get: () => undefined };

  // 생성자는 실제 DbService<PimSchema>/FormExportFileClient/FormExportSnapshotReader/
  // ProductCategoriesService/ConfigService 타입을 요구한다 — 이 페이크들은 매니저가 실제로
  // 부르는 메서드만 구조적으로 흉내내므로 `as never` 캐스팅은 이 하네스 관례를 따른다
  // (form-export-job.manager.spec.ts:192-202).
  const manager = new BulkSessionJobManager(
    db as never,
    { download } as never,
    { renderMaster } as never,
    { getCategoryTree } as never,
    config as never,
  );
  return { manager, updates, inserts, trx, download, renderMaster, getCategoryTree };
}

const SESSION_ROW: FakeRow = {
  sourceFileId: 'file-1',
  uploadedBy: 'user-1',
  exportId: null,
};

const CLAIMED = { sessionId: 'sess-1', leaseToken: 'tok-1', phase: 'uploaded' };

beforeEach(() => {
  parserModule.parseUploadWorkbook.mockReset();
  parserModule.parseUploadWorkbook.mockResolvedValue(parsedUpload());
});

describe('BulkSessionJobManager.claim', () => {
  it('SKIP LOCKED 로 세션 하나만 잡고, uploaded·validating 을 둘 다 후보로 둔다', async () => {
    const { manager, trx } = makeHarness({ claimed: [{ id: 'sess-1', phase: 'validating' }] });

    const claimed = await manager.claim();

    // 매처(expect.any)를 object literal 안에 섞으면 그 `any` 반환 타입이
    // no-unsafe-assignment 를 낸다 — form-export-job.manager.spec.ts:274-277 과 같은 이유로 따로 뗀다.
    expect(claimed?.sessionId).toBe('sess-1');
    expect(claimed?.phase).toBe('validating');
    expect(claimed!.leaseToken).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const { sql, params } = renderQuery(trx.execute.mock.calls[0][0]);
    const lowered = sql.toLowerCase();
    expect(lowered).toContain('for update skip locked');
    expect(lowered).toContain('limit 1');
    expect(lowered).toContain("'uploaded'");
    // 재개 경로: validating 을 후보에서 빼면 lease 가 만료된 세션이 영영 멈춘다.
    expect(lowered).toContain("'validating'");
    // 취소된 세션을 다시 집지 않는다.
    expect(lowered).toContain('cancel_requested_at is null');
    // ::uuid 캐스트가 빠지면 PG 가 text 바인딩과 uuid 컬럼을 맞추지 못해 실패한다.
    expect(lowered).toContain('::uuid');
    // 만료시각은 DB 시계가 만든다 — Date 를 raw sql 에 바인딩하면 드라이버가 죽는다.
    expect(params.some((p) => p instanceof Date)).toBe(false);
    expect(params).toContain(claimed!.leaseToken);
  });

  it('클레임마다 새 토큰을 발급한다 — 두 워커가 같은 토큰을 들면 CAS 가 무력해진다', async () => {
    const { manager } = makeHarness({ claimed: [{ id: 'sess-1', phase: 'uploaded' }] });

    const first = await manager.claim();
    const second = await manager.claim();

    expect(first!.leaseToken).not.toBe(second!.leaseToken);
  });

  it('클레임할 세션이 없으면 null 이다', async () => {
    const { manager } = makeHarness({ claimed: [] });
    expect(await manager.claim()).toBeNull();
  });
});

describe('BulkSessionJobManager.runParseSlice', () => {
  it('파일 오류가 나면 세션을 failed 로 확정하고 items 를 만들지 않는다', async () => {
    parserModule.parseUploadWorkbook.mockRejectedValue(new BadRequestError('유효한 엑셀(.xlsx) 파일이 아닙니다.'));
    const { manager, updates, inserts } = makeHarness();

    await manager.runParseSlice(CLAIMED);

    const failed = updates.find((u) => u.values.phase === 'failed');
    expect(failed).toBeDefined();
    expect(failed!.values.phaseError).toBe('유효한 엑셀(.xlsx) 파일이 아닙니다.');
    expect(inserts).toHaveLength(0);
  });

  it('다운로드 실패는 삼키지 않는다 — 일시적일 수 있어 연속 실패 카운터가 세야 한다', async () => {
    const { manager, updates } = makeHarness({ downloadError: new Error('file-service 503') });

    await expect(manager.runParseSlice(CLAIMED)).rejects.toThrow('file-service 503');
    expect(updates).toHaveLength(0);
  });

  // ─── 카탈로그 중복 생성 방어선 ───
  // 프리필 행을 신규로 재분류하면 카탈로그가 통째로 중복 생성된다(스펙 §3.1 ⚠️).
  // 다만 그 사고의 최종 상태는 "export_id 살아있음 + items 0행" 이 **아니다** — FK 가
  // ON DELETE SET NULL 이라 export_id 가 NULL 이 되고 items 는 CASCADE 로 사라진다.
  // 그래서 방어선은 아래 NULL 케이스 하나고, 0행 양식은 정상으로 통과시켜야 한다.
  it('exportId 는 살아있는데 items 가 0행인 양식(프리필 대상이 없던 양식)은 실패시키지 않는다', async () => {
    parserModule.parseUploadWorkbook.mockResolvedValue(
      parsedUpload({
        exportId: 'exp-1',
        sheets: { ...parsedUpload().sheets, products: [productRow(2, { rowKey: 'NEW-1', name: '신규' })] },
      }),
    );
    const { manager, updates, inserts } = makeHarness({
      // draft 만 있는 상품만 골라 받으면 renderMaster 가 전부 건너뛰어 product_count=0 인
      // 양식이 정상 completed 된다(form-export.snapshot.reader.ts:125). 접수 게이트도
      // 그런 양식을 명시적으로 통과시킨다(bulk-session.manager.ts:184-187) — 여기서
      // 실패시키면 멀쩡한 양식을 두고 "양식을 찾을 수 없다"고 말하게 된다.
      sessionRow: { ...SESSION_ROW, exportId: 'exp-1' },
      exportItems: [],
    });

    await manager.runParseSlice(CLAIMED);

    expect(updates.find((u) => u.values.phase === 'failed')).toBeUndefined();
    // 프리필 행이 정말 없었으므로 전 행이 create 인 것은 오분류가 아니라 사실이다.
    const items = inserts.find((i) => i.table === 'items')!.values;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'create', masterId: null, baseSnapshot: null });
  });

  it('세션 export_id 는 NULL 인데 워크북이 exportId 를 들고 있으면(양식 삭제됨) failed 다', async () => {
    parserModule.parseUploadWorkbook.mockResolvedValue(
      parsedUpload({
        exportId: 'exp-1',
        sheets: { ...parsedUpload().sheets, products: [productRow(2, { rowKey: 'P-000001', name: '가' })] },
      }),
    );
    const { manager, updates, inserts } = makeHarness({ sessionRow: { ...SESSION_ROW, exportId: null } });

    await manager.runParseSlice(CLAIMED);

    expect(updates.find((u) => u.values.phase === 'failed')).toBeDefined();
    expect(inserts).toHaveLength(0);
  });

  it('exportId 도 워크북 메타도 없는 세션은 정상적인 신규 전용 세션이라 그대로 진행한다', async () => {
    parserModule.parseUploadWorkbook.mockResolvedValue(
      parsedUpload({
        sheets: { ...parsedUpload().sheets, products: [productRow(2, { rowKey: 'NEW-1', name: '신규' })] },
      }),
    );
    const { manager, updates, inserts } = makeHarness();

    await manager.runParseSlice(CLAIMED);

    expect(updates.find((u) => u.values.phase === 'failed')).toBeUndefined();
    const items = inserts.find((i) => i.table === 'items');
    expect(items!.values).toHaveLength(1);
    expect(items!.values[0]).toMatchObject({ kind: 'create', baseSnapshot: null, masterId: null, payload: null });
  });

  it('exportId 가 있는 세션의 수정 행은 base_snapshot·base_version_id·master_id 를 채운다', async () => {
    const snapshot = snapshotOf();
    parserModule.parseUploadWorkbook.mockResolvedValue(
      parsedUpload({
        exportId: 'exp-1',
        sheets: {
          ...parsedUpload().sheets,
          products: [
            productRow(2, { rowKey: 'P-000001', name: '고침' }),
            productRow(3, { rowKey: 'NEW-1', name: '신규' }),
          ],
        },
      }),
    );
    const { manager, inserts } = makeHarness({
      sessionRow: { ...SESSION_ROW, exportId: 'exp-1' },
      exportItems: [{ rowKey: 'P-000001', masterId: 'm-1', versionId: 'v-1', snapshot, pricingEditable: false }],
    });

    await manager.runParseSlice(CLAIMED);

    const items = inserts.find((i) => i.table === 'items')!.values;
    expect(items[0]).toMatchObject({
      rowKey: 'P-000001',
      kind: 'update',
      masterId: 'm-1',
      baseVersionId: 'v-1',
      baseSnapshot: snapshot,
    });
    // 스냅샷 번들 위에 **권위 있는** pricing_editable 을 얹어 나른다 — 검증 슬라이스가 그
    // 판정을 스냅샷 판매가 셀이 센티넬인지로 역산하지 않게 하기 위해서다.
    expect(items[0].baseSnapshot).toMatchObject({ pricingEditable: false });
    // 양식에 없던 상품키는 신규다.
    expect(items[1]).toMatchObject({ rowKey: 'NEW-1', kind: 'create', masterId: null, baseSnapshot: null });
  });

  it('present 를 배열로 눕혀 담는다 — Set 이면 jsonb 왕복에서 {} 가 된다', async () => {
    parserModule.parseUploadWorkbook.mockResolvedValue(
      parsedUpload({
        sheets: { ...parsedUpload().sheets, products: [productRow(2, { rowKey: 'NEW-1', name: '신규' })] },
      }),
    );
    const { manager, inserts } = makeHarness();

    await manager.runParseSlice(CLAIMED);

    const input = inserts.find((i) => i.table === 'items')!.values[0].input as BulkItemInput;
    expect(Array.isArray(input.present.products)).toBe(true);
    expect(input.present.products).toEqual(expect.arrayContaining(['name']));
    // 실제 jsonb 왕복을 흉내내 "직렬화하면 사라지는가"까지 본다 — Set 이면 여기서 {} 가 된다.
    const roundTripped = JSON.parse(JSON.stringify(input)) as BulkItemInput;
    expect(roundTripped.present.products).toEqual(input.present.products);
  });

  it('이미지 시트의 fileId 행은 resolved, 파일명 행은 awaiting_upload 다', async () => {
    const fileId = '11111111-2222-4333-8444-555555555555';
    parserModule.parseUploadWorkbook.mockResolvedValue(
      parsedUpload({
        sheets: {
          ...parsedUpload().sheets,
          products: [
            productRow(2, { rowKey: 'NEW-1', name: '신규', thumbnailImageKey: 'IMG-1', additionalImageKeys: 'IMG-2' }),
          ],
          images: [
            { rowNumber: 2, cells: { imageKey: 'IMG-1', sourceValue: fileId } },
            { rowNumber: 3, cells: { imageKey: 'IMG-2', sourceValue: '가을신상.jpg' } },
          ],
        },
      }),
    );
    const { manager, inserts } = makeHarness();

    await manager.runParseSlice(CLAIMED);

    const images = inserts.find((i) => i.table === 'images')!.values;
    expect(images).toEqual([
      expect.objectContaining({ imageKey: 'IMG-1', usage: 'main', sourceKind: 'file_id', fileId, status: 'resolved' }),
      expect.objectContaining({
        imageKey: 'IMG-2',
        usage: 'main',
        sourceKind: 'file_name',
        fileId: null,
        status: 'awaiting_upload',
      }),
    ]);
  });

  it('상품에 못 붙는 시트 오류는 합성 아이템으로 남는다 — 조용히 버리면 작업자가 영영 모른다', async () => {
    parserModule.parseUploadWorkbook.mockResolvedValue(
      parsedUpload({
        sheets: {
          ...parsedUpload().sheets,
          products: [productRow(2, { rowKey: 'NEW-1', name: '신규' })],
          // 상품 시트에 없는 상품키를 참조한 고아 옵션 행.
          options: [{ rowNumber: 5, cells: { rowKey: '없는키', optionKey: 'g1', optionValueKey: 'v1' } }],
        },
      }),
    );
    const { manager, inserts } = makeHarness();

    await manager.runParseSlice(CLAIMED);

    const items = inserts.find((i) => i.table === 'items')!.values;
    const orphan = items.find((v) => String(v.rowKey).startsWith('__orphan__:'));
    // payload 는 non-null(검증 슬라이스가 안 집는다) 이면서 isBulkItemPayload 가드도
    // 만족해야 한다 — 3·4단계가 status 필터를 빠뜨려도 되읽기가 죽지 않는다.
    expect(orphan).toMatchObject({
      rowKey: '__orphan__:옵션:5',
      kind: 'create',
      status: 'invalid',
      payload: { fields: {} },
    });
    expect(isBulkItemPayload(orphan!.payload)).toBe(true);
    expect(String(orphan!.errorMessage)).toContain('없는키');
  });

  it('이미지 원본이 URL 이면 이미지 행을 만들지 않고 합성 아이템으로 남긴다', async () => {
    parserModule.parseUploadWorkbook.mockResolvedValue(
      parsedUpload({
        sheets: {
          ...parsedUpload().sheets,
          products: [productRow(2, { rowKey: 'NEW-1', name: '신규', thumbnailImageKey: 'IMG-1' })],
          images: [{ rowNumber: 4, cells: { imageKey: 'IMG-1', sourceValue: 'https://example.com/a.jpg' } }],
        },
      }),
    );
    const { manager, inserts } = makeHarness();

    await manager.runParseSlice(CLAIMED);

    expect(inserts.find((i) => i.table === 'images')).toBeUndefined();
    const orphan = inserts
      .find((i) => i.table === 'items')!
      .values.find((v) => String(v.rowKey).startsWith('__orphan__'));
    expect(String(orphan!.errorMessage)).toContain('URL 은 지원하지 않습니다');
  });

  it('여러 상품이 같은 불량 이미지키를 참조해도 합성 아이템은 하나다', async () => {
    parserModule.parseUploadWorkbook.mockResolvedValue(
      parsedUpload({
        sheets: {
          ...parsedUpload().sheets,
          products: [
            productRow(2, { rowKey: 'NEW-1', name: '가', thumbnailImageKey: 'IMG-1' }),
            // 같은 키를 다른 상품이, 게다가 다른 용도(부가)로 또 참조한다.
            productRow(3, { rowKey: 'NEW-2', name: '나', additionalImageKeys: 'IMG-1' }),
          ],
          images: [{ rowNumber: 4, cells: { imageKey: 'IMG-1', sourceValue: 'https://example.com/a.jpg' } }],
        },
      }),
    );
    const { manager, inserts } = makeHarness();

    await manager.runParseSlice(CLAIMED);

    const orphans = inserts
      .find((i) => i.table === 'items')!
      .values.filter((v) => String(v.rowKey).startsWith('__orphan__'));
    expect(orphans).toHaveLength(1);
    expect(orphans[0].rowKey).toBe('__orphan__:이미지:4');
  });

  it('상품키가 중복돼도 INSERT 가 죽지 않는다 — 저장용 키만 유일하게 바꾼다', async () => {
    parserModule.parseUploadWorkbook.mockResolvedValue(
      parsedUpload({
        sheets: {
          ...parsedUpload().sheets,
          products: [
            productRow(2, { rowKey: 'DUP', name: '가' }),
            productRow(3, { rowKey: 'DUP', name: '나' }),
            productRow(4, { rowKey: '', name: '다' }),
          ],
        },
      }),
    );
    const { manager, inserts } = makeHarness();

    await manager.runParseSlice(CLAIMED);

    const items = inserts.find((i) => i.table === 'items')!.values;
    const keys = items.map((v) => v.rowKey);
    expect(new Set(keys).size).toBe(keys.length);
    // 원본 상품키는 input.errors 의 메시지로 남아 작업자가 어느 줄인지 알 수 있다.
    const dupInput = items[1].input as BulkItemInput;
    expect(dupInput.errors.some((e) => e.message.includes('DUP'))).toBe(true);
  });

  it('마감 CAS 가 0행이면 items 를 쓰지 않는다 — 좀비가 후임의 행을 덮어쓰면 안 된다', async () => {
    parserModule.parseUploadWorkbook.mockResolvedValue(
      parsedUpload({
        sheets: { ...parsedUpload().sheets, products: [productRow(2, { rowKey: 'NEW-1', name: '신규' })] },
      }),
    );
    const { manager, inserts } = makeHarness({ finalizeOwned: false });

    await manager.runParseSlice(CLAIMED);

    expect(inserts).toHaveLength(0);
  });

  it('마감은 토큰 CAS + 취소 가드를 함께 건다', async () => {
    parserModule.parseUploadWorkbook.mockResolvedValue(
      parsedUpload({
        sheets: { ...parsedUpload().sheets, products: [productRow(2, { rowKey: 'NEW-1', name: '신규' })] },
      }),
    );
    const { manager, updates } = makeHarness();

    await manager.runParseSlice(CLAIMED);

    const finalize = updates.find((u) => u.values.phase === 'validating')!;
    const { sql, params } = renderQuery(finalize.condition);
    expect(sql.toLowerCase()).toMatch(/"lease_token"\s*=/);
    expect(sql.toLowerCase()).toContain('"cancel_requested_at" is null');
    expect(params).toContain('tok-1');
    // 다음 틱이 곧바로 검증 슬라이스로 이어받도록 lease 를 같은 트랜잭션에서 놓는다.
    expect(finalize.values).toMatchObject({ leaseUntil: null, leaseToken: null, totalRows: 1 });
  });
});

describe('BulkSessionJobManager.runValidateSlice', () => {
  const VALIDATING = { sessionId: 'sess-1', leaseToken: 'tok-1', phase: 'validating' };

  function itemRow(overrides: FakeRow = {}): FakeRow {
    return {
      id: 'item-1',
      sessionId: 'sess-1',
      rowNumber: 2,
      rowKey: 'P-000001',
      kind: 'create',
      masterId: null,
      baseVersionId: null,
      baseSnapshot: null,
      input: {
        bundle: {
          product: { name: '신규', basePrice: '1000' },
          options: [],
          variants: [],
          categories: [],
          constraint: null,
        },
        present: { ...EMPTY_PRESENT, products: ['name', 'basePrice'] },
        errors: [],
      },
      payload: null,
      status: 'pending',
      ...overrides,
    };
  }

  it('변경이 0건인 수정 행도 payload 를 쓴다 — NULL 이 "미검증"의 유일한 의미여야 한다', async () => {
    const snapshot = snapshotOf();
    const { manager, updates } = makeHarness({
      bulkItems: [
        itemRow({
          kind: 'update',
          masterId: 'm-1',
          baseVersionId: 'v-1',
          baseSnapshot: snapshot,
          input: {
            // 업로드가 스냅샷과 완전히 같다 → 변경 0건.
            bundle: { product: { ...snapshot.product }, options: [], variants: [], categories: [], constraint: null },
            present: { ...EMPTY_PRESENT, products: ['name', 'basePrice', 'membershipPrice', 'brand'] },
            errors: [],
          },
        }),
      ],
      renderMasterResult: { ...snapshotOf(), versionId: 'v-1' },
    });

    await manager.runValidateSlice(VALIDATING);

    const itemUpdate = updates.find((u) => u.table === 'items')!;
    expect(itemUpdate.values.payload).toEqual({ fields: {} });
    expect(itemUpdate.values.status).toBe('pending');
    expect(itemUpdate.values.errorMessage).toBeNull();
    expect(itemUpdate.values.conflict).toBeNull();
  });

  it('오류가 있으면 status=invalid 로 굳히고 시트·행 좌표를 error_message 에 싣는다', async () => {
    const { manager, updates } = makeHarness({
      bulkItems: [
        itemRow({
          input: {
            bundle: {
              product: { name: '신규', basePrice: '0' },
              options: [],
              variants: [],
              categories: [],
              constraint: null,
            },
            present: { ...EMPTY_PRESENT, products: ['name', 'basePrice'] },
            errors: [],
          },
        }),
      ],
    });

    await manager.runValidateSlice(VALIDATING);

    const itemUpdate = updates.find((u) => u.table === 'items')!;
    expect(itemUpdate.values.status).toBe('invalid');
    expect(String(itemUpdate.values.errorMessage)).toContain('[상품 2행]');
    // 오류가 있어도 payload 는 반드시 쓴다.
    expect(itemUpdate.values.payload).not.toBeNull();
  });

  it('접합 단계 오류가 이미 있으면 그대로 invalid 로 굳힌다', async () => {
    const { manager, updates, renderMaster } = makeHarness({
      bulkItems: [
        itemRow({
          input: {
            bundle: { product: { name: '신규' }, options: [], variants: [], categories: [], constraint: null },
            present: { ...EMPTY_PRESENT, products: ['name'] },
            errors: [{ sheet: '상품', rowNumber: 2, message: '상품키는 필수입니다.' }],
          },
        }),
      ],
    });

    await manager.runValidateSlice(VALIDATING);

    expect(renderMaster).not.toHaveBeenCalled();
    const itemUpdate = updates.find((u) => u.table === 'items')!;
    expect(itemUpdate.values.status).toBe('invalid');
    expect(itemUpdate.values.payload).toEqual({ fields: {} });
  });

  it('input 형식이 다르면 그 행만 invalid 로 만들고 세션을 죽이지 않는다', async () => {
    const { manager, updates } = makeHarness({ bulkItems: [itemRow({ input: { legacy: true } })] });

    await manager.runValidateSlice(VALIDATING);

    const itemUpdate = updates.find((u) => u.table === 'items')!;
    expect(itemUpdate.values.status).toBe('invalid');
    expect(String(itemUpdate.values.errorMessage)).toContain('행 데이터 형식');
  });

  it('lease 를 잃으면 즉시 멈춘다 — 후임과 같은 행을 나란히 처리하면 안 된다', async () => {
    const { manager, updates } = makeHarness({ bulkItems: [itemRow(), itemRow({ id: 'item-2' })], renewRows: [] });

    await manager.runValidateSlice(VALIDATING);

    expect(updates.filter((u) => u.table === 'items')).toHaveLength(0);
    // lease 를 놓는 update 도 없어야 한다 — 이미 남의 것이다.
    expect(updates.filter((u) => u.values.leaseToken === null)).toHaveLength(0);
  });

  it('취소 요청을 만나면 lease 만 놓고 멈춘다', async () => {
    const { manager, updates } = makeHarness({
      bulkItems: [itemRow()],
      renewRows: [{ cancelRequestedAt: new Date() }],
    });

    await manager.runValidateSlice(VALIDATING);

    expect(updates.filter((u) => u.table === 'items')).toHaveLength(0);
    const release = updates.filter((u) => u.table === 'sessions' && u.values.leaseToken === null);
    expect(release).toHaveLength(1);
    expect(release[0].values.phase).toBeUndefined();
  });

  it('미검증 행이 없으면 phase 를 review 로 밀고 토큰 CAS + 취소 가드를 건다', async () => {
    const { manager, updates } = makeHarness({ bulkItems: [] });

    await manager.runValidateSlice(VALIDATING);

    const finish = updates.find((u) => u.values.phase === 'review')!;
    const { sql, params } = renderQuery(finish.condition);
    expect(sql.toLowerCase()).toMatch(/"lease_token"\s*=/);
    expect(sql.toLowerCase()).toContain('"cancel_requested_at" is null');
    expect(params).toContain('tok-1');
    expect(finish.values).toMatchObject({ leaseUntil: null, leaseToken: null });
  });

  it('기준 상품의 active 가 사라졌으면 그 행만 invalid 다', async () => {
    const { manager, updates } = makeHarness({
      bulkItems: [itemRow({ kind: 'update', masterId: 'm-1', baseVersionId: 'v-1', baseSnapshot: snapshotOf() })],
      renderMasterResult: null,
    });

    await manager.runValidateSlice(VALIDATING);

    const itemUpdate = updates.find((u) => u.table === 'items')!;
    expect(itemUpdate.values.status).toBe('invalid');
    expect(String(itemUpdate.values.errorMessage)).toContain('판매 중인 버전을 찾을 수 없습니다');
    // 슬라이스는 계속 돌고 마지막에 lease 를 놓는다.
    expect(updates.some((u) => u.table === 'sessions' && u.values.leaseToken === null)).toBe(true);
  });

  it('현재 active 는 스냅샷의 이미지 키 배정을 seed 로 넣어 다시 그린다', async () => {
    const snapshot = snapshotOf({ images: { 'IMG-7': 'file-a' } });
    const { manager, renderMaster } = makeHarness({
      bulkItems: [itemRow({ kind: 'update', masterId: 'm-1', baseVersionId: 'v-1', baseSnapshot: snapshot })],
    });

    await manager.runValidateSlice(VALIDATING);

    const [, , allocator] = renderMaster.mock.calls[0] as [unknown, string, { keyFor(fileId: string): string }];
    // seed 가 빠지면 안 바뀐 이미지가 IMG-1 부터 다시 번호를 받아 전 행이 변경으로 뜬다.
    expect(allocator.keyFor('file-a')).toBe('IMG-7');
  });

  // `pricingEditable` 이 없는 스냅샷 = 이 필드를 싣기 전 코드가 쓴 행이다(롤링 배포 중
  // 파싱과 검증 사이에 배포가 낀 경우). 그때는 옛 센티넬 역산으로 폴백해야 한다 — 폴백을
  // 지우면 그 행들이 전부 "가격 수정 가능"으로 뒤집혀 조용히 통과한다.
  it('가격 표현 가능 여부는 양식에 얼린 판정을 쓴다 — 지금 룰을 다시 판정하지 않는다 (옛 행 폴백)', async () => {
    // 스냅샷 판매가가 센티넬이다 = 다운로드 시점에 "임포트로 못 고침"으로 판정됐다.
    const snapshot = snapshotOf({
      product: { name: '기존', basePrice: PRICING_SENTINEL, membershipPrice: PRICING_SENTINEL },
    });
    const { manager, updates } = makeHarness({
      bulkItems: [
        itemRow({
          kind: 'update',
          masterId: 'm-1',
          baseVersionId: 'v-1',
          baseSnapshot: snapshot,
          input: {
            bundle: {
              product: { name: '기존', basePrice: '9900' },
              options: [],
              variants: [],
              categories: [],
              constraint: null,
            },
            present: { ...EMPTY_PRESENT, products: ['name', 'basePrice'] },
            errors: [],
          },
        }),
      ],
      renderMasterResult: { ...snapshotOf(), versionId: 'v-1' },
    });

    await manager.runValidateSlice(VALIDATING);

    const itemUpdate = updates.find((u) => u.table === 'items')!;
    expect(itemUpdate.values.status).toBe('invalid');
    expect(String(itemUpdate.values.errorMessage)).toContain('임포트로 수정할 수 없습니다');
  });

  // ─── 권위 컬럼이 센티넬 역산을 이긴다 ───
  //
  // 역산(`snapshot.product.basePrice !== PRICING_SENTINEL`)을 유일한 경로로 두면
  // `PRICING_SENTINEL` 문자열을 바꾸는 날 **이미 저장된 스냅샷 전부**에서 판정이 조용히
  // 뒤집힌다. 아래 두 테스트는 두 신호가 **어긋나게** 만들어 어느 쪽이 이기는지 못 박는다 —
  // 폴백만 남은 구현에서는 둘 다 빨간불이 된다.
  it('스냅샷 셀이 평범한 숫자여도 권위 컬럼이 false 면 가격을 못 고친다', async () => {
    // 셀만 보면 "고칠 수 있음"으로 역산된다. 그런데 다운로드 시점의 권위 판정은 false 였다.
    const snapshot = { ...snapshotOf(), pricingEditable: false };
    const { manager, updates } = makeHarness({
      bulkItems: [
        itemRow({
          kind: 'update',
          masterId: 'm-1',
          baseVersionId: 'v-1',
          baseSnapshot: snapshot,
          input: {
            bundle: {
              product: { name: '기존 상품', basePrice: '9900' },
              options: [],
              variants: [],
              categories: [],
              constraint: null,
            },
            present: { ...EMPTY_PRESENT, products: ['name', 'basePrice'] },
            errors: [],
          },
        }),
      ],
      renderMasterResult: { ...snapshotOf(), versionId: 'v-1' },
    });

    await manager.runValidateSlice(VALIDATING);

    const itemUpdate = updates.find((u) => u.table === 'items')!;
    expect(itemUpdate.values.status).toBe('invalid');
    expect(String(itemUpdate.values.errorMessage)).toContain('임포트로 수정할 수 없습니다');
  });

  it('스냅샷 셀이 센티넬이어도 권위 컬럼이 true 면 가격을 고칠 수 있다', async () => {
    const snapshot = {
      ...snapshotOf({ product: { name: '기존', basePrice: PRICING_SENTINEL, membershipPrice: PRICING_SENTINEL } }),
      pricingEditable: true,
    };
    const { manager, updates } = makeHarness({
      bulkItems: [
        itemRow({
          kind: 'update',
          masterId: 'm-1',
          baseVersionId: 'v-1',
          baseSnapshot: snapshot,
          input: {
            bundle: {
              product: { name: '기존', basePrice: '9900' },
              options: [],
              variants: [],
              categories: [],
              constraint: null,
            },
            present: { ...EMPTY_PRESENT, products: ['name', 'basePrice'] },
            errors: [],
          },
        }),
      ],
      renderMasterResult: { ...snapshotOf(), versionId: 'v-1' },
    });

    await manager.runValidateSlice(VALIDATING);

    const itemUpdate = updates.find((u) => u.table === 'items')!;
    expect(itemUpdate.values.status).toBe('pending');
    expect(itemUpdate.values.errorMessage).toBeNull();
  });

  // ─── '이미지' 시트 부재 (파서는 이 시트를 필수로 두지 않는다) ───
  it("'이미지' 시트가 없어도, 안 건드린 프리필 이미지 참조는 그 행을 죽이지 않는다", async () => {
    const fileId = '11111111-2222-4333-8444-555555555555';
    const snapshot = snapshotOf({
      product: { name: '기존 상품', basePrice: '10000', membershipPrice: '', thumbnailImageKey: 'IMG-1' },
      images: { 'IMG-1': fileId },
    });
    const { manager, updates } = makeHarness({
      bulkItems: [
        itemRow({
          kind: 'update',
          masterId: 'm-1',
          baseVersionId: 'v-1',
          baseSnapshot: snapshot,
          input: {
            // 대표이미지키는 프리필 그대로고, 작업자는 상품명만 고쳤다.
            bundle: {
              product: { ...snapshot.product, name: '고친 이름' },
              options: [],
              variants: [],
              categories: [],
              constraint: null,
            },
            present: { ...EMPTY_PRESENT, products: ['name', 'basePrice', 'membershipPrice', 'thumbnailImageKey'] },
            errors: [],
          },
        }),
      ],
      // 파싱 슬라이스가 이미지 행을 하나도 만들지 못했다 = 시트가 없었다.
      bulkImages: [],
      renderMasterResult: { ...snapshot, versionId: 'v-1' },
    });

    await manager.runValidateSlice(VALIDATING);

    const itemUpdate = updates.find((u) => u.table === 'items')!;
    expect(itemUpdate.values.status).toBe('pending');
    expect(itemUpdate.values.errorMessage).toBeNull();
    expect(itemUpdate.values.payload).toEqual({ fields: { 'product.name': '고친 이름' } });
  });

  it("'이미지' 시트가 없는데 대표이미지키를 **바꿨으면** 그 행은 invalid 다", async () => {
    const snapshot = snapshotOf({
      product: { name: '기존 상품', basePrice: '10000', membershipPrice: '', thumbnailImageKey: 'IMG-1' },
      images: { 'IMG-1': '11111111-2222-4333-8444-555555555555' },
    });
    const { manager, updates } = makeHarness({
      bulkItems: [
        itemRow({
          kind: 'update',
          masterId: 'm-1',
          baseVersionId: 'v-1',
          baseSnapshot: snapshot,
          input: {
            bundle: {
              product: { ...snapshot.product, thumbnailImageKey: 'IMG-9' },
              options: [],
              variants: [],
              categories: [],
              constraint: null,
            },
            present: { ...EMPTY_PRESENT, products: ['name', 'basePrice', 'membershipPrice', 'thumbnailImageKey'] },
            errors: [],
          },
        }),
      ],
      bulkImages: [],
      renderMasterResult: { ...snapshot, versionId: 'v-1' },
    });

    await manager.runValidateSlice(VALIDATING);

    const itemUpdate = updates.find((u) => u.table === 'items')!;
    expect(itemUpdate.values.status).toBe('invalid');
    expect(String(itemUpdate.values.errorMessage)).toContain('IMG-9');
  });

  it('남이 먼저 바꾼 필드는 충돌로 잡고, 내가 안 건드린 필드는 잡지 않는다', async () => {
    const snapshot = snapshotOf();
    const { manager, updates } = makeHarness({
      bulkItems: [
        itemRow({
          kind: 'update',
          masterId: 'm-1',
          baseVersionId: 'v-1',
          baseSnapshot: snapshot,
          input: {
            bundle: {
              product: { ...snapshot.product, brand: '내가바꾼브랜드' },
              options: [],
              variants: [],
              categories: [],
              constraint: null,
            },
            present: { ...EMPTY_PRESENT, products: ['name', 'basePrice', 'membershipPrice', 'brand'] },
            errors: [],
          },
        }),
      ],
      // 현재 active 에서는 남이 brand 를 또 다르게 바꿔놨다.
      renderMasterResult: {
        ...snapshotOf({ product: { ...snapshot.product, brand: '남이바꾼브랜드' } }),
        versionId: 'v-1',
      },
    });

    await manager.runValidateSlice(VALIDATING);

    const itemUpdate = updates.find((u) => u.table === 'items')!;
    expect(itemUpdate.values.payload).toEqual({ fields: { 'product.brand': '내가바꾼브랜드' } });
    expect(itemUpdate.values.conflict).toEqual({
      'product.brand': { base: '기존브랜드', mine: '내가바꾼브랜드', current: '남이바꾼브랜드' },
    });
    // 충돌은 오류가 아니다 — 사람이 결정할 때까지 pending 이다.
    expect(itemUpdate.values.status).toBe('pending');
  });

  it('카테고리는 적용분에 category.set 이 있을 때만 해석한다', async () => {
    const { manager, updates } = makeHarness({
      bulkItems: [
        itemRow({
          input: {
            bundle: {
              product: { name: '신규', basePrice: '1000' },
              options: [],
              variants: [],
              categories: [{ categoryPath: '여성패션>니트', isPrimary: 'Y' }],
              constraint: null,
            },
            present: { ...EMPTY_PRESENT, products: ['name', 'basePrice'], categories: ['categoryPath', 'isPrimary'] },
            errors: [],
          },
        }),
      ],
      categoryTree: {
        categories: [{ id: 'c-1', name: '여성패션', isActive: true, children: [] }],
      },
    });

    await manager.runValidateSlice(VALIDATING);

    const itemUpdate = updates.find((u) => u.table === 'items')!;
    // '여성패션>니트' 는 트리에 없다 → 경로 미해석 오류.
    expect(String(itemUpdate.values.errorMessage)).toContain('카테고리 경로를 찾을 수 없습니다');
    expect(itemUpdate.values.status).toBe('invalid');
  });

  it('세션에 없는 이미지키를 참조하면 그 행이 invalid 다', async () => {
    const { manager, updates } = makeHarness({
      bulkItems: [
        itemRow({
          input: {
            bundle: {
              product: { name: '신규', basePrice: '1000', thumbnailImageKey: 'IMG-9' },
              options: [],
              variants: [],
              categories: [],
              constraint: null,
            },
            present: { ...EMPTY_PRESENT, products: ['name', 'basePrice', 'thumbnailImageKey'] },
            errors: [],
          },
        }),
      ],
      bulkImages: [],
    });

    await manager.runValidateSlice(VALIDATING);

    const itemUpdate = updates.find((u) => u.table === 'items')!;
    expect(String(itemUpdate.values.errorMessage)).toContain('IMG-9');
    expect(itemUpdate.values.status).toBe('invalid');
  });

  it('참조가 해석되면 payload 에 imageRefs 를 얹는다', async () => {
    const { manager, updates } = makeHarness({
      bulkItems: [
        itemRow({
          input: {
            bundle: {
              product: { name: '신규', basePrice: '1000', thumbnailImageKey: 'IMG-1' },
              options: [],
              variants: [],
              categories: [],
              constraint: null,
            },
            present: { ...EMPTY_PRESENT, products: ['name', 'basePrice', 'thumbnailImageKey'] },
            errors: [],
          },
        }),
      ],
      bulkImages: [{ imageKey: 'IMG-1', sourceValue: '가을신상.jpg' }],
    });

    await manager.runValidateSlice(VALIDATING);

    const itemUpdate = updates.find((u) => u.table === 'items')!;
    expect(itemUpdate.values.status).toBe('pending');
    expect(itemUpdate.values.payload).toMatchObject({ imageRefs: [{ imageKey: 'IMG-1', usage: 'main' }] });
  });
});

describe('BulkSessionJobManager.recordJobError', () => {
  it('레인을 벗어난 세션은 건드리지 않는다 — 좀비의 뒤늦은 예외가 review 를 실패로 끌면 안 된다', async () => {
    const { manager, updates } = makeHarness();

    await manager.recordJobError('sess-1', '일시적 오류');

    const { sql } = renderQuery(updates[0].condition);
    expect(sql.toLowerCase()).toContain('"phase" in');
  });

  it('상한 미만이면 phase 를 바꾸지 않는다 — 일시적 오류로 세션을 영구 실패시키지 않는다', async () => {
    const { manager, updates } = makeHarness();

    await manager.recordJobError('sess-1', '일시적 오류');

    expect(updates).toHaveLength(1);
    expect(updates[0].values.phaseError).toBe('일시적 오류');
    expect(updates[0].values.phase).toBeUndefined();
  });

  it('상한에 닿으면 failed 로 확정하고 lease 를 지운다 — 그래야 무한 재시도가 끝난다', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { manager, updates } = makeHarness({ failures: MAX_CONSECUTIVE_BULK_FAILURES });

    try {
      await manager.recordJobError('sess-1', '결정적 오류');
      // 단정은 restore **전에** 한다 — mockRestore 는 호출 이력까지 지운다.
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('sess-1'));
    } finally {
      errorSpy.mockRestore();
    }

    expect(updates).toHaveLength(2);
    expect(updates[1].values).toMatchObject({ phase: 'failed', leaseUntil: null, leaseToken: null });
    // 확정 update 는 **토큰 CAS 를 걸지 않는다** — 걸면 소유권이 좀비에서 후임으로 넘어간
    // 순간 상한이 영원히 발화하지 못한다(선례와 같은 근거).
    const { params } = renderQuery(updates[1].condition);
    expect(params).toEqual(['sess-1']);
  });
});
