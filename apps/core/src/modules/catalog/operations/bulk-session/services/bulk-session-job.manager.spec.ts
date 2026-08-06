// (Task 8) `BulkSessionJobManager` 가 이제 `BulkDraftApplier` 를 정적으로 끌어오고, 그게 다시
// `product-masters.service.ts` 를 통해 bare `@packages/event-contracts` 를 import 한다 — 루트
// jest 설정의 moduleNameMapper 에는 `^@packages/event-contracts/(.*)$`(하위 경로)만 있고 bare
// 경로 항목이 없어 해석되지 않는다(레포 상시 debt). 레포 선례(bulk-draft.applier.spec.ts,
// product-versions.service.spec.ts)와 같은 모양으로 가상 모듈을 세운다.
jest.mock(
  '@packages/event-contracts',
  () => ({
    PRODUCT_STREAM: { topic: { topic: 'products.events.v1' }, aggregateType: 'Product' },
  }),
  { virtual: true },
);

import { Logger, NotFoundException } from '@nestjs/common';
import { BadRequestError } from '@app/shared';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  productBulkSessions,
  productBulkItems,
  productBulkImages,
  productMasterVersions,
} from '../../../schema/catalog.schema';
import { BulkSessionJobManager, MAX_CONSECUTIVE_BULK_FAILURES, imageResolverFrom } from './bulk-session-job.manager';
import type { DraftInput } from './bulk-draft.applier';
import type { ParsedUpload, RawSheetRow } from './bulk-upload.parser';
import type { PrefillBundle } from './form-export.types';
import { PRICING_SENTINEL } from './form-export.sheets';
import { isBulkItemPayload, type BulkItemInput, type FlatFields } from './bulk-session.types';
import { buildOptionAdd, type OptionPlan } from './bulk-draft.options';

/**
 * 기록되는 페이크 applier. 기본은 성공이고, 케이스가 `fail` 로 특정 행만 던지게 만든다.
 *
 * `apply()` 에 넘어온 **실제 `DraftInput`** 을 `inputs` 에 쌓는다(Fix round 1 리뷰 Important 2)
 * — 그래야 `optionRows`/`conflictDecision`/`baseSnapshot`/`images` 조립이 실제로 검증된다.
 *
 * (판단) 행 식별은 **호출 순서**를 대리로 쓴다. 브리프 원안은 `input.rowNumber` 였지만
 * `DraftInput`(bulk-draft.applier.ts) 에는 그런 필드가 없다 — `draftOne` 이 넘기는 객체
 * 리터럴에 없는 필드를 얹으면 초과 프로퍼티 검사에 걸린다. `runDraftSlice` 가 `rowNumber`
 * 오름차순으로 순회하므로(select 의 `orderBy`), n 번째 호출은 항상 n 번째로 작은 rowNumber
 * 를 가진 행이다 — 테스트가 이미 그 순서로 `bulkItems` 를 구성한다.
 */
function makeApplier(fail?: (callOrder: number) => boolean) {
  const applied: number[] = [];
  const inputs: DraftInput[] = [];
  return {
    applied,
    inputs,
    apply: (input: DraftInput) => {
      inputs.push(input);
      const callOrder = applied.length + 1;
      applied.push(callOrder);
      if (fail?.(callOrder)) return Promise.reject(new Error('생성 실패'));
      return Promise.resolve({ draftVersionId: 'draft-1', masterId: 'master-1' });
    },
  };
}

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

/** drizzle 셀렉트 빌더는 thenable 이면서 where/orderBy/limit/for 가 체이닝된다. */
interface SelectChain extends Promise<FakeRow[]> {
  where(condition?: unknown): SelectChain;
  orderBy(...columns: unknown[]): SelectChain;
  limit(n?: number): SelectChain;
  /** `FOR UPDATE` 행 잠금. `draftOne` 의 취소 재확인이 이걸 쓴다. */
  for(mode?: string): SelectChain;
}

/**
 * 트랜잭션 경계까지 담은 **순서 있는** 연산 로그. `selects`/`updates` 는 종류별로 나뉘어
 * 있어 "이 문장이 저 문장보다 먼저인가"를 볼 수 없는데, `draftOne` 의 잠금은 **트랜잭션의
 * 첫 문장**이어야만 의미가 있다(별도 트랜잭션이거나 apply 뒤면 취소 창이 그대로 남는다).
 */
interface TrxOp {
  kind: 'begin' | 'end' | 'select' | 'insert' | 'update' | 'call';
  table?: string;
  /** select 에 `.for('update')` 가 붙었는지. */
  forUpdate?: boolean;
  /** `kind: 'call'` 일 때 어느 서비스 메서드 호출인지 — `publishOne` 의 관문 ④ 순서
   *  (잠금 해제 UPDATE 가 `publishVersion` 보다 먼저인가)를 관측할 유일한 수단이다. */
  fn?: string;
}

/**
 * `onWhere` 는 `.where()` 에 넘어온 조건을 그대로 기록만 한다(rowMatchesCondition 처럼 실제로
 * 거르지 않는다) — 이 파일의 기존 테스트들은 조건 없이 `rowsFor(table)` 이 준 행을 그대로
 * 쓰는 것을 전제로 하므로, 여기서 필터링을 추가하면 그 테스트들의 픽스처를 전부 다시 짜야
 * 한다. drafting 슬라이스 테스트는 "렌더된 SQL 에 정확한 술어가 있는가"만 본다(bulk-session.
 * manager.spec.ts:40 의 `dialect.sqlToQuery` 선례와 같은 깊이).
 */
function selectChain(rows: FakeRow[], onWhere?: (condition: unknown) => void, onFor?: () => void): SelectChain {
  // Promise 인스턴스에 체이너를 얹어 thenable+체이너블 양쪽을 만족시킨다 — 이 형태 자체가
  // 실제 drizzle 빌더 타입과 구조적으로 다르므로 캐스팅이 불가피하다.
  const builder = Promise.resolve(rows) as SelectChain;
  builder.where = (condition) => {
    onWhere?.(condition);
    return builder;
  };
  builder.orderBy = () => builder;
  builder.limit = () => builder;
  builder.for = () => {
    onFor?.();
    return builder;
  };
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
  /** drafting 슬라이스가 쓰는 페이크 applier. 기본은 항상 성공하는 `makeApplier()`. */
  applier?: ReturnType<typeof makeApplier>;
  /** 발행 슬라이스의 `getVersionById` 가 돌려줄 draft 버전. 기본은 발행 시점 가드(관문 ③)를
   *  통과하는 조합이다 — parentVersionId 가 아래 `publishActiveVersion.id` 와 같다. */
  publishDraftVersion?: FakeRow;
  /** 발행 슬라이스의 `getActiveVersion` 이 돌려줄 현재 active. `null` 이면 "active 없음"
   *  (실제 서비스가 던지는 NotFoundException)을 흉내낸다 — 신규 행의 정상 상태다. */
  publishActiveVersion?: FakeRow | null;
  /** `publishActiveVersion` 이 `null` 일 때 `getActiveVersion` 이 던질 오류. 기본은 실제
   *  서비스와 같은 `NotFoundException`이다 — 관문 ③의 "NotFound 가 아니면 되던진다" 회귀를
   *  잠그려면 이 필드로 다른 오류 클래스(커넥션 끊김 등)를 주입한다. */
  publishActiveVersionError?: Error;
  /** `BulkVariantCodeChecker.checkSession` 의 반환값(새로 invalid 로 표시한 행 수). 기본 0. */
  variantCodeFlagged?: number;
  /** (Task 8) `resolveExisting`(수정 행)이 돌려줄 조합키 → variantId. 기본은 빈 맵
   *  (= 아무 조합도 안 풀린다 — 해석 실패 경로가 그 기본값을 그대로 쓴다). */
  comboMap?: Map<string, string>;
  /**
   * (Task 8) `resolveCreated`(신규 행)가 돌려줄 조합키 → variantId. **`comboMap` 과 반드시
   * 다른 값을 준다** — 둘이 같은 맵을 돌려주면 "`kind` 에 따라 올바른 해석기가 선택되는가" 가
   * 아예 잠기지 않는다(두 호출을 뒤바꿔도 초록이 된다).
   */
  createdComboMap?: Map<string, string>;
}

function makeHarness(opts: HarnessOpts = {}) {
  const updates: Array<{ table: string; values: FakeRow; condition?: unknown }> = [];
  const inserts: Array<{ table: string; values: FakeRow[] }> = [];
  const selects: Array<{ table: string; condition: unknown }> = [];
  const ops: TrxOp[] = [];

  const tableName = (table: unknown): string => {
    if (table === productBulkSessions) return 'sessions';
    if (table === productBulkItems) return 'items';
    if (table === productBulkImages) return 'images';
    if (table === productMasterVersions) return 'masterVersions';
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
    select: () => ({
      from: (table) => {
        const op: TrxOp = { kind: 'select', table: tableName(table), forUpdate: false };
        ops.push(op);
        return selectChain(
          rowsFor(table),
          (condition) => selects.push({ table: tableName(table), condition }),
          () => {
            op.forUpdate = true;
          },
        );
      },
    }),
    insert: (table) => ({
      values: (values) => {
        inserts.push({ table: tableName(table), values: values as FakeRow[] });
        ops.push({ kind: 'insert', table: tableName(table) });
        return Promise.resolve();
      },
    }),
    update: (table) => ({
      set: (values) => ({
        where: (condition): UpdateChain => {
          updates.push({ table: tableName(table), values, condition });
          ops.push({ kind: 'update', table: tableName(table) });
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

  // `run` 마다 begin/end 마커를 남긴다 — 페이크에는 진짜 트랜잭션이 없으므로 이 마커가
  // "어느 문장이 어느 트랜잭션 안인가"를 관측할 유일한 수단이다.
  const db = {
    run: <T>(fn: (t: FakeTrx) => Promise<T>) => {
      ops.push({ kind: 'begin' });
      return fn(trx).finally(() => ops.push({ kind: 'end' }));
    },
  };
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
  const applier = opts.applier ?? makeApplier();

  // 발행 슬라이스가 쓰는 ProductVersionsService 페이크. 세 메서드만 흉내낸다.
  // `publishVersion` 호출은 `ops` 에도 마커를 남긴다 — 관문 ④(잠금 해제가 발행보다 먼저)의
  // **순서**를 확인하려면 masterVersions UPDATE 와 이 호출의 상대 위치가 필요하기 때문이다.
  const publishDraftVersion: FakeRow = {
    id: 'draft-1',
    masterId: 'master-1',
    parentVersionId: 'v-base',
    status: 'draft',
    ...opts.publishDraftVersion,
  };
  const publishActiveVersion = opts.publishActiveVersion === undefined ? { id: 'v-base' } : opts.publishActiveVersion;
  const getVersionById = jest.fn(() => Promise.resolve(publishDraftVersion));
  const getActiveVersion = jest.fn(() =>
    publishActiveVersion
      ? Promise.resolve(publishActiveVersion)
      : Promise.reject(opts.publishActiveVersionError ?? new NotFoundException('활성 버전을 찾을 수 없습니다')),
  );
  const publishVersion = jest.fn(() => {
    ops.push({ kind: 'call', fn: 'publishVersion' });
    return Promise.resolve();
  });
  const versions = { getVersionById, getActiveVersion, publishVersion };

  // 검증 슬라이스의 마감 분기(items.length===0)가 review 전 세션 전역 variantCode 검사를
  // 부른다(Task 11) — 실제 구현을 세우지 않고 반환값만 흉내낸다. `ops` 에도 마커를 남겨
  // "review CAS 보다 먼저 불렸는가" 순서를 확인할 수 있게 한다.
  const checkSession = jest.fn(() => {
    ops.push({ kind: 'call', fn: 'checkSession' });
    return Promise.resolve(opts.variantCodeFlagged ?? 0);
  });
  const variantCodes = { checkSession };

  // (Task 8) 발행 슬라이스의 정책 적용 경로가 쓰는 둘. `updateVariantStockPolicy` 도 `ops` 에
  // 마커를 남긴다 — "정책 적용이 publishVersion **뒤**인가"는 두 호출의 상대 위치로만 관측된다.
  // 인자 타입을 명시한다 — `mock.calls[0]` 을 구조분해해 `plan` 을 검사하려면 튜플이 필요하다
  // (인자 없는 `jest.fn(() => …)` 은 calls 원소가 `[]` 로 좁혀져 인덱스 접근이 막힌다).
  type ComboMap = Map<string, string>;
  const resolveExisting = jest.fn<Promise<ComboMap>, [string, string, unknown]>(() =>
    Promise.resolve(opts.comboMap ?? new Map<string, string>()),
  );
  const resolveCreated = jest.fn<Promise<ComboMap>, [string, string, FlatFields, OptionPlan, unknown]>(() =>
    Promise.resolve(opts.createdComboMap ?? new Map<string, string>()),
  );
  const combos = { resolveExisting, resolveCreated };
  const updateVariantStockPolicy = jest.fn(() => {
    ops.push({ kind: 'call', fn: 'updateVariantStockPolicy' });
    return Promise.resolve({});
  });
  const skuMapping = { updateVariantStockPolicy };

  // 생성자는 실제 DbService<PimSchema>/FormExportFileClient/FormExportSnapshotReader/
  // ProductCategoriesService/BulkDraftApplier/ProductVersionsService/ConfigService/
  // BulkVariantCodeChecker/BulkSessionComboResolver/ProductSkuMappingService 타입을 요구한다 —
  // 이 페이크들은 매니저가 실제로 부르는 메서드만 구조적으로 흉내내므로 `as never` 캐스팅은
  // 이 하네스 관례를 따른다 (form-export-job.manager.spec.ts:192-202).
  const manager = new BulkSessionJobManager(
    db as never,
    { download } as never,
    { renderMaster } as never,
    { getCategoryTree } as never,
    applier as never,
    versions as never,
    config as never,
    variantCodes as never,
    combos as never,
    skuMapping as never,
  );
  return {
    manager,
    updates,
    inserts,
    selects,
    ops,
    trx,
    download,
    renderMaster,
    getCategoryTree,
    applier,
    versions,
    checkSession,
    combos,
    skuMapping,
  };
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
    const { manager, updates, checkSession } = makeHarness({ bulkItems: [] });

    await manager.runValidateSlice(VALIDATING);

    const finish = updates.find((u) => u.values.phase === 'review')!;
    const { sql, params } = renderQuery(finish.condition);
    expect(sql.toLowerCase()).toMatch(/"lease_token"\s*=/);
    expect(sql.toLowerCase()).toContain('"cancel_requested_at" is null');
    expect(params).toContain('tok-1');
    expect(finish.values).toMatchObject({ leaseUntil: null, leaseToken: null });
    // review 로 넘기기 직전에 세션 전역 variantCode 사전검사(Task 11)를 정확히 이 세션에 대해 부른다.
    expect(checkSession).toHaveBeenCalledWith('sess-1');
  });

  it('세션 전역 variantCode 검사는 미검증 행이 남아 있으면 부르지 않는다 — 아직 못 본 코드로 오판할 수 있다', async () => {
    const { manager, checkSession } = makeHarness({ bulkItems: [itemRow()] });

    await manager.runValidateSlice(VALIDATING);

    expect(checkSession).not.toHaveBeenCalled();
  });

  it('세션 전역 variantCode 검사는 review CAS 보다 먼저 불린다', async () => {
    const { manager, ops } = makeHarness({ bulkItems: [] });

    await manager.runValidateSlice(VALIDATING);

    const checkOrder = ops.findIndex((op) => op.kind === 'call' && op.fn === 'checkSession');
    const reviewOrder = ops.findIndex((op) => op.kind === 'update' && op.table === 'sessions');
    expect(checkOrder).toBeGreaterThanOrEqual(0);
    expect(checkOrder).toBeLessThan(reviewOrder);
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

describe('BulkSessionJobManager.runDraftSlice', () => {
  const DRAFTING = { sessionId: 'sess-1', leaseToken: 'tok-1', phase: 'drafting' };

  function draftItemRow(overrides: FakeRow = {}): FakeRow {
    return {
      id: 'item-1',
      sessionId: 'sess-1',
      rowNumber: 2,
      rowKey: 'NEW-1',
      kind: 'create',
      masterId: null,
      baseSnapshot: null,
      input: {
        bundle: { product: { name: '신규' }, options: [], variants: [], categories: [], constraint: null },
        present: { ...EMPTY_PRESENT, products: ['name'] },
        errors: [],
      },
      payload: { fields: { 'product.name': '신규' } },
      conflictDecision: null,
      status: 'pending',
      ...overrides,
    };
  }

  it('drafting 슬라이스는 status=pending 인 행만 집는다', async () => {
    const { manager, selects } = makeHarness({ bulkItems: [] });

    await manager.runDraftSlice(DRAFTING);

    const itemsSelect = selects.find((s) => s.table === 'items')!;
    const { sql, params } = renderQuery(itemsSelect.condition);
    expect(sql.toLowerCase()).toContain('"status" =');
    expect(params).toContain('pending');
  });

  it('행 하나가 실패해도 나머지가 계속 진행된다', async () => {
    const applier = makeApplier((callOrder) => callOrder === 2);
    const { manager, updates } = makeHarness({
      applier,
      bulkItems: [
        draftItemRow({ id: 'item-1', rowNumber: 2 }),
        draftItemRow({ id: 'item-2', rowNumber: 3 }),
        draftItemRow({ id: 'item-3', rowNumber: 4 }),
      ],
    });

    await manager.runDraftSlice(DRAFTING);

    const itemUpdates = updates.filter((u) => u.table === 'items');
    expect(itemUpdates.map((u) => u.values.status)).toEqual(['drafted', 'failed', 'drafted']);
    expect(String(itemUpdates[1].values.errorMessage)).toContain('생성 실패');
  });

  it('성공한 행에 draft_version_id 와 master_id 를 적는다', async () => {
    const { manager, updates } = makeHarness({ bulkItems: [draftItemRow()] });

    await manager.runDraftSlice(DRAFTING);

    const itemUpdate = updates.find((u) => u.table === 'items')!;
    expect(itemUpdate.values).toMatchObject({ status: 'drafted', draftVersionId: 'draft-1', masterId: 'master-1' });
  });

  // Fix round 1 리뷰 Important 2: applier.apply 가 받는 DraftInput 이 실제로 조립되는지 잠근다
  // — optionRows 는 원본 시트 행에서, conflictDecision 은 맵으로 변환돼, baseSnapshot 은
  // 그대로, images 는 imageResolverFrom(item, imageRows) 의 결과가 넘어가야 한다.
  it('applier.apply 에 optionRows·conflictDecision·baseSnapshot·images 를 조립해 넘긴다', async () => {
    const applier = makeApplier();
    const optionRows = [{ rowKey: 'NEW-1', optionKey: 'g1', optionValueKey: 'v1' }];
    const baseSnapshot = snapshotOf();
    const { manager } = makeHarness({
      applier,
      bulkItems: [
        draftItemRow({
          kind: 'update',
          masterId: 'm-1',
          baseSnapshot,
          input: {
            bundle: { product: { name: '신규' }, options: optionRows, variants: [], categories: [], constraint: null },
            present: { ...EMPTY_PRESENT, products: ['name'] },
            errors: [],
          },
          conflictDecision: { 'product.name': 'overwrite' },
        }),
      ],
      // 세션 이미지 행 — imageResolverFrom 이 이걸 우선한다(단독 단위 테스트는 아래
      // describe('imageResolverFrom') 이 순서 규칙 자체를 잠근다).
      bulkImages: [{ imageKey: 'IMG-1', usage: 'main', fileId: 'file-a' }],
    });

    await manager.runDraftSlice(DRAFTING);

    const [input] = applier.inputs;
    expect(input.optionRows).toEqual(optionRows);
    expect(input.conflictDecision).toEqual({ 'product.name': 'overwrite' });
    expect(input.baseSnapshot).toMatchObject(baseSnapshot);
    expect(input.images.fileIdFor('IMG-1', 'main')).toBe('file-a');
  });

  it('남은 행이 없으면 phase 를 drafted 로 민다 (토큰 CAS + 취소 가드)', async () => {
    const { manager, updates } = makeHarness({ bulkItems: [] });

    await manager.runDraftSlice(DRAFTING);

    const finish = updates.find((u) => u.values.phase === 'drafted')!;
    const { sql, params } = renderQuery(finish.condition);
    expect(sql.toLowerCase()).toMatch(/"lease_token"\s*=/);
    expect(sql.toLowerCase()).toContain('"cancel_requested_at" is null');
    expect(params).toContain('tok-1');
    expect(finish.values).toMatchObject({ leaseUntil: null, leaseToken: null });
  });

  it('lease 를 잃으면 즉시 멈춘다', async () => {
    const applier = makeApplier();
    const { manager, updates } = makeHarness({
      applier,
      bulkItems: [draftItemRow(), draftItemRow({ id: 'item-2' })],
      renewRows: [],
    });

    await manager.runDraftSlice(DRAFTING);

    expect(applier.applied).toEqual([]);
    expect(updates.filter((u) => u.table === 'items')).toHaveLength(0);
  });

  it('취소가 감지되면 lease 만 놓고 멈춘다', async () => {
    const { manager, updates } = makeHarness({
      bulkItems: [draftItemRow()],
      renewRows: [{ cancelRequestedAt: new Date() }],
    });

    await manager.runDraftSlice(DRAFTING);

    expect(updates.filter((u) => u.table === 'items')).toHaveLength(0);
    const release = updates.filter((u) => u.table === 'sessions' && u.values.leaseToken === null);
    expect(release).toHaveLength(1);
    expect(release[0].values.phase).toBeUndefined();
  });

  // 부록 A.8 인계: error_message 는 행 목록 API 에 원문 그대로 나간다 — 최소한 길이는 자른다.
  it('오류 메시지는 500자로 잘린다 — 원문 예외 텍스트가 관리자 화면에 그대로 나가면 안 된다', async () => {
    const longMessage = '오'.repeat(600);
    const applier = {
      applied: [] as number[],
      inputs: [] as DraftInput[],
      apply: () => Promise.reject(new Error(longMessage)),
    };
    const { manager, updates } = makeHarness({ applier, bulkItems: [draftItemRow()] });

    await manager.runDraftSlice(DRAFTING);

    const itemUpdate = updates.find((u) => u.table === 'items')!;
    expect(itemUpdate.values.status).toBe('failed');
    expect(String(itemUpdate.values.errorMessage).length).toBe(500);
  });

  // 최종 리뷰 발견 ②: 이 catch(draftOne)가 지금까지 classifyPublishError 를 전혀 부르지
  // 않고 예외 원문(영어 DB 오류 포함)을 그대로 error_message 에 실었다 — §10.7 이 "닫았다"고
  // 적은 errorMessage 분류는 실은 publishOne 쪽에만 걸려 있었다. 분류가 붙었는지와, 원문이
  // 로그로는 여전히 남는지를 함께 잠근다.
  it('draft 생성 실패는 원문이 아니라 분류된 문구를 error_message 에 남기고, 원문은 로그로 남는다', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const applier = {
      applied: [] as number[],
      inputs: [] as DraftInput[],
      apply: () => Promise.reject(new Error('value too long for type character varying(50)')),
    };
    const { manager, updates } = makeHarness({ applier, bulkItems: [draftItemRow()] });

    await manager.runDraftSlice(DRAFTING);

    const itemUpdate = updates.find((u) => u.table === 'items')!;
    expect(itemUpdate.values.errorMessage).toBe('입력한 값이 저장할 수 있는 길이(50자)를 넘었습니다.');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('value too long for type character varying(50)'),
      expect.any(String),
    );
    warnSpy.mockRestore();
  });

  // ─────────── 취소 레이스 (최종 리뷰 ①) ───────────
  //
  // `renewLease` 의 취소 검사와 draft 트랜잭션의 커밋 사이에 취소가 커밋되면, 그 행의 draft 는
  // `bulk_session_id` 를 단 채 커밋된다. `cancel()` 의 해제 UPDATE 는 미커밋 draft 를 못 보고,
  // 그 값을 나중에 지우는 경로가 레포에 없어 draft 가 영구 미아가 된다(발행·삭제·재취소 전부
  // 차단, my-drafts 에도 안 나옴). 아래 두 케이스가 그 방어선을 잠근다.
  it('draftOne 트랜잭션의 첫 문장은 세션 행 FOR UPDATE 잠금이다', async () => {
    const { manager, ops } = makeHarness({ bulkItems: [draftItemRow()] });

    await manager.runDraftSlice(DRAFTING);

    // 행을 drafted 로 적는 UPDATE 가 들어있는 트랜잭션을 찾아, 그 begin 바로 다음 문장을 본다.
    const updateIndex = ops.findIndex((op) => op.kind === 'update' && op.table === 'items');
    expect(updateIndex).toBeGreaterThan(0);
    let beginIndex = updateIndex;
    while (ops[beginIndex].kind !== 'begin') beginIndex -= 1;
    // 잠금이 apply 뒤로 밀리거나 별도 트랜잭션으로 빠지면 취소 창이 그대로 남는다.
    expect(ops[beginIndex + 1]).toEqual({ kind: 'select', table: 'sessions', forUpdate: true });
  });

  it('트랜잭션 안에서 취소가 관측되면 draft 도 행 갱신도 하지 않는다 (실패로도 적지 않는다)', async () => {
    const applier = makeApplier();
    const { manager, updates } = makeHarness({
      applier,
      bulkItems: [draftItemRow()],
      // renewLease 는 취소를 **못 본다** — 그 검사 직후에 취소가 커밋된 상황을 흉내낸다.
      renewRows: [{ cancelRequestedAt: null }],
      // 반면 트랜잭션 안의 FOR UPDATE 재확인은 커밋된 취소를 본다.
      sessionRow: { ...SESSION_ROW, cancelRequestedAt: new Date() },
    });

    await manager.runDraftSlice(DRAFTING);

    expect(applier.applied).toEqual([]);
    // 'drafted' 도 'failed' 도 아니다 — 취소된 세션의 행은 실패한 것이 아니라 그냥 pending 이다.
    expect(updates.filter((u) => u.table === 'items')).toHaveLength(0);
  });

  // 롤링 배포 가드: 접수·검증과 drafting 사이에 배포가 끼면 옛 코드가 쓴 payload 를 만날 수
  // 있다 — validateOne 의 isBulkItemInput 가드와 같은 이유로 그 행만 죽인다.
  it('payload 형식이 다르면 그 행만 실패시키고 applier 를 부르지 않는다', async () => {
    const applier = makeApplier();
    const { manager, updates } = makeHarness({ applier, bulkItems: [draftItemRow({ payload: { legacy: true } })] });

    await manager.runDraftSlice(DRAFTING);

    expect(applier.applied).toEqual([]);
    const itemUpdate = updates.find((u) => u.table === 'items')!;
    expect(itemUpdate.values.status).toBe('failed');
  });
});

describe('BulkSessionJobManager.runPublishSlice', () => {
  const PUBLISHING = { sessionId: 'sess-1', leaseToken: 'tok-1', phase: 'publishing' };

  // (Task 8) `payload`/`input` 은 실제 DB 행이면 항상 채워져 있다(`validateOne` 이 어떤 경로로
  // 끝나든 payload 를 쓰고, `input` 은 notNull 이다) — 발행이 그 둘에서 정책 차분을 뽑으므로
  // 픽스처도 그 모양을 갖춘다. 기본은 정책 칸이 하나도 없는 행이다.
  function publishItemRow(overrides: FakeRow = {}): FakeRow {
    return {
      id: 'item-1',
      sessionId: 'sess-1',
      rowNumber: 2,
      kind: 'update',
      status: 'drafted',
      publishStatus: 'pending',
      draftVersionId: 'draft-1',
      masterId: 'master-1',
      payload: { fields: {} },
      input: {
        bundle: { product: {}, options: [], variants: [], categories: [], constraint: null },
        present: EMPTY_PRESENT,
        errors: [],
      },
      ...overrides,
    };
  }

  /**
   * 정책 칸이 실린 행. `extractVariantPolicies` 는 **둘 다** 본다 — 차분(`payload.fields`)이
   * "무엇이 바뀌었나"를, 시트 원본(`input.bundle.variants`)이 "안 바뀐 짝 칸의 값"을 준다.
   */
  function policyItemRow(
    fields: Record<string, string>,
    variantRows: Array<Record<string, string>>,
    overrides: FakeRow = {},
  ): FakeRow {
    return publishItemRow({
      payload: { fields },
      input: {
        bundle: { product: {}, options: [], variants: variantRows, categories: [], constraint: null },
        present: EMPTY_PRESENT,
        errors: [],
      },
      ...overrides,
    });
  }

  /** 발행 슬라이스가 items 에 쓴 값 하나. 이 스위트의 픽스처는 항상 행 하나뿐이다. */
  function itemUpdatesOf(updates: Array<{ table: string; values: FakeRow }>): FakeRow[] {
    return updates.filter((u) => u.table === 'items').map((u) => u.values);
  }

  // 관문 ①: 세션 행 FOR UPDATE 잠금이 트랜잭션의 첫 문장이어야 한다. `renewLease`(루프의
  // 값싼 앞단 필터)만으로는 부족하다 — 그 검사와 이 커밋 사이에 취소가 커밋되면 "취소했는데
  // 상품이 발행됨"이 된다. 4단계 draftOne 회귀 테스트(위 파일 상단)와 같은 형태로, ops 로그의
  // begin 바로 다음 문장을 본다.
  it('발행 트랜잭션의 첫 문장은 세션 행 FOR UPDATE 잠금이다', async () => {
    const { manager, ops } = makeHarness({ bulkItems: [publishItemRow()] });

    await manager.runPublishSlice(PUBLISHING);

    const updateIndex = ops.findIndex((op) => op.kind === 'update' && op.table === 'items');
    expect(updateIndex).toBeGreaterThan(0);
    let beginIndex = updateIndex;
    while (ops[beginIndex].kind !== 'begin') beginIndex -= 1;
    // 잠금이 publishVersion 뒤로 밀리면 취소 레이스의 창이 그대로 남는다.
    expect(ops[beginIndex + 1]).toEqual({ kind: 'select', table: 'sessions', forUpdate: true });
  });

  // 관문 ①의 실효성: renewLease 는 취소를 못 보게, 잠근 세션 행은 취소를 보게 둔다 —
  // 정확히 draftOne 이 막던 그 창이다(스펙 §10.4).
  it('트랜잭션 안에서 취소가 관측되면 발행도 행 갱신도 하지 않는다', async () => {
    const { manager, versions, updates } = makeHarness({
      bulkItems: [publishItemRow()],
      // renewLease 는 취소를 **못 본다** — 그 검사 직후에 취소가 커밋된 상황을 흉내낸다.
      renewRows: [{ cancelRequestedAt: null }],
      // 트랜잭션 안의 FOR UPDATE 재확인은 커밋된 취소를 본다.
      sessionRow: { ...SESSION_ROW, cancelRequestedAt: new Date() },
    });

    await manager.runPublishSlice(PUBLISHING);

    expect(versions.publishVersion).not.toHaveBeenCalled();
    expect(updates.filter((u) => u.table === 'items')).toHaveLength(0);
  });

  // 관문 ③: 발행 시점 가드. 현재 active 가 draft 의 parentVersionId 와 다르면 그 사이 남이
  // 먼저 발행했다는 뜻이고, 그대로 발행하면 남의 변경이 통째로 사라진다(스펙 §2.2·§3.10).
  it('현재 active 가 draft 의 parentVersionId 와 다르면 그 행만 실패시킨다', async () => {
    const { manager, versions, updates } = makeHarness({
      bulkItems: [publishItemRow({ draftVersionId: 'V-draft' })],
      publishDraftVersion: { id: 'V-draft', masterId: 'master-1', parentVersionId: 'V-base', status: 'draft' },
      publishActiveVersion: { id: 'V-other' },
    });

    await manager.runPublishSlice(PUBLISHING);

    expect(versions.publishVersion).not.toHaveBeenCalled();
    const itemUpdates = updates.filter((u) => u.table === 'items');
    expect(itemUpdates).toHaveLength(1);
    expect(itemUpdates[0].values.publishStatus).toBe('failed');
    expect(String(itemUpdates[0].values.publishError)).toContain('기준이 변경되었습니다');
  });

  // 관문 ③ 회귀 (code review Important): `getActiveVersion` 이 NotFound 로 던지는 것은
  // "active 가 없다"는 신규 행의 정상 상태다 — parentVersionId=null 과 currentActiveId=null
  // 이 일치해 가드를 통과해야 한다. 세션 행의 절반이 신규 행이라 이 경로에 커버리지가
  // 없으면 관문 ③ 은 수정 행에서만 검증된 셈이다.
  it('신규 행은 active 가 없어도 발행된다 (getActiveVersion 의 NotFound 는 정상 흐름이다)', async () => {
    const { manager, versions, updates } = makeHarness({
      bulkItems: [publishItemRow({ draftVersionId: 'V-draft' })],
      publishDraftVersion: { id: 'V-draft', masterId: 'master-1', parentVersionId: null, status: 'draft' },
      // 신규 행: active 가 아직 없다 — 기본값(NotFoundException)을 그대로 쓴다.
      publishActiveVersion: null,
    });

    await manager.runPublishSlice(PUBLISHING);

    expect(versions.publishVersion).toHaveBeenCalledWith('V-draft', expect.anything(), {
      origin: 'bulk_import',
      importSessionId: 'sess-1',
    });
    const itemUpdate = updates.find((u) => u.table === 'items')!;
    expect(itemUpdate.values.publishStatus).toBe('published');
  });

  // 관문 ③ 회귀 (code review Important): bare catch 였을 때 정확히 이 픽스처가 가드를
  // 우회시켰다 — parentVersionId=null 인 신규 행에서 getActiveVersion 이 NotFound **가
  // 아닌** 오류(커넥션 끊김 등)를 던지면 currentActiveId 가 조용히 null 이 되어
  // `null !== null` 이 거짓이 되므로 가드가 통과해 버렸다. 되던지기가 이 사고를 막는다 —
  // 바깥 catch 가 그 오류를 분류해 이 행만 실패시켜야 한다.
  it('getActiveVersion 이 NotFound 가 아닌 오류를 던지면 그 행을 실패시킨다 (가드를 통과시키지 않는다)', async () => {
    const { manager, versions, updates } = makeHarness({
      bulkItems: [publishItemRow({ draftVersionId: 'V-draft' })],
      publishDraftVersion: { id: 'V-draft', masterId: 'master-1', parentVersionId: null, status: 'draft' },
      publishActiveVersion: null,
      publishActiveVersionError: new Error('커넥션 끊김'),
    });

    await manager.runPublishSlice(PUBLISHING);

    expect(versions.publishVersion).not.toHaveBeenCalled();
    const itemUpdates = updates.filter((u) => u.table === 'items');
    expect(itemUpdates).toHaveLength(1);
    expect(itemUpdates[0].values.publishStatus).toBe('failed');
  });

  // 관문 ④: bulk_session_id 를 풀고 나서 publishVersion 을 부른다. `publishVersion` 자신이
  // bulkSessionId 가 남아있으면 409 로 거부하므로(product-versions.service.ts:274-276),
  // 순서가 바뀌면 이 호출이 바로 그 자리에서 죽는다.
  it('발행 직전에 bulk_session_id 를 풀고 publishVersion 을 origin=bulk_import 로 부른다', async () => {
    const { manager, versions, updates, ops } = makeHarness({
      bulkItems: [publishItemRow({ draftVersionId: 'V-draft' })],
      publishDraftVersion: { id: 'V-draft', masterId: 'master-1', parentVersionId: 'V-base', status: 'draft' },
      publishActiveVersion: { id: 'V-base' },
    });

    await manager.runPublishSlice(PUBLISHING);

    const versionUpdate = updates.find((u) => u.table === 'masterVersions')!;
    const { params } = renderQuery(versionUpdate.condition);
    expect(params).toContain('V-draft');
    expect(versionUpdate.values).toMatchObject({ bulkSessionId: null });
    expect(versions.publishVersion).toHaveBeenCalledWith('V-draft', expect.anything(), {
      origin: 'bulk_import',
      importSessionId: 'sess-1',
    });

    // 순서가 계약이다 — 잠금 해제가 뒤로 가면 publishVersion 이 409 로 죽는다.
    const versionUpdateOpIndex = ops.findIndex((op) => op.kind === 'update' && op.table === 'masterVersions');
    const publishCallOpIndex = ops.findIndex((op) => op.kind === 'call' && op.fn === 'publishVersion');
    expect(versionUpdateOpIndex).toBeGreaterThan(-1);
    expect(publishCallOpIndex).toBeGreaterThan(versionUpdateOpIndex);
  });

  // ─── (Task 8) 정책 적용 ───
  //
  // 품목 판매정책은 상품 버전에 담기지 않는다(설계 스펙 §2) — 그래서 발행 레인이 행마다
  // "버전 발행(변경분이 있으면) + 정책 적용(정책 변경이 있으면)"을 한다. 아래 넷이 그 갈래
  // 전부다: 정책만 · 버전+정책(순서) · 정책 없음 · 해석 실패.

  it('draft 가 없는 행은 버전을 발행하지 않고 정책만 적용한다', async () => {
    const { manager, versions, skuMapping, updates } = makeHarness({
      bulkItems: [
        policyItemRow(
          { 'variant:c1.availabilityOverride': '품절' },
          [{ combination: 'c1', availabilityOverride: '품절' }],
          {
            draftVersionId: null,
            masterId: 'm1',
          },
        ),
      ],
      comboMap: new Map([['c1', 'v1']]),
    });

    await manager.runPublishSlice(PUBLISHING);

    // 버전 변경분이 비어 draft 가 아예 없다 — 발행할 버전이 없다는 뜻이지 실패가 아니다.
    expect(versions.publishVersion).not.toHaveBeenCalled();
    expect(skuMapping.updateVariantStockPolicy).toHaveBeenCalledWith(
      'v1',
      { availabilityOverride: 'manual_out_of_stock', comingSoonDate: null },
      expect.anything(),
    );
    // 정책 적용 대상 버전은 현재 active 다 — draft 가 없으므로 다른 후보가 없다.
    expect(versions.getActiveVersion).toHaveBeenCalledWith('m1', expect.anything());
    // 매처(expect.any)를 object literal 안에 섞지 않는다 — 그 `any` 반환 타입이
    // no-unsafe-assignment 를 낸다(이 파일 위쪽 claim 스펙과 같은 이유).
    const itemUpdates = itemUpdatesOf(updates);
    expect(itemUpdates).toHaveLength(1);
    expect(itemUpdates[0]).toMatchObject({ publishStatus: 'published', publishError: null });
    expect(itemUpdates[0].updatedAt).toBeInstanceOf(Date);
  });

  it('draft 가 있는 행은 발행 뒤에 정책을 적용한다', async () => {
    const { manager, skuMapping, ops } = makeHarness({
      bulkItems: [
        policyItemRow({ 'variant:c1.preStockSellable': 'Y' }, [{ combination: 'c1', preStockSellable: 'Y' }], {
          draftVersionId: 'V-draft',
        }),
      ],
      publishDraftVersion: { id: 'V-draft', masterId: 'master-1', parentVersionId: 'V-base', status: 'draft' },
      publishActiveVersion: { id: 'V-base' },
      comboMap: new Map([['c1', 'v1']]),
    });

    await manager.runPublishSlice(PUBLISHING);

    expect(skuMapping.updateVariantStockPolicy).toHaveBeenCalledWith(
      'v1',
      { preStockSellable: true },
      expect.anything(),
    );
    // 순서가 계약이다: 신규 행은 발행되어야 variant 가 존재하고, 수정 행은 CoW 인계
    // (_reconcileMatchingsAfterPublish)를 받은 뒤라야 작업자가 적은 값이 인계값을 이긴다.
    // 뒤집히면 둘 다 **조용히** 틀린다 — 그래서 ops 로그로 상대 위치를 못 박는다.
    const publishIndex = ops.findIndex((op) => op.kind === 'call' && op.fn === 'publishVersion');
    const policyIndex = ops.findIndex((op) => op.kind === 'call' && op.fn === 'updateVariantStockPolicy');
    expect(publishIndex).toBeGreaterThan(-1);
    expect(policyIndex).toBeGreaterThan(publishIndex);
  });

  it('정책 변경이 없는 행은 정책 API 도 조합 해석도 부르지 않는다', async () => {
    const { manager, skuMapping, combos } = makeHarness({
      bulkItems: [policyItemRow({ 'product.brand': '나이키' }, [], { draftVersionId: 'V-draft' })],
      publishDraftVersion: { id: 'V-draft', masterId: 'master-1', parentVersionId: 'V-base', status: 'draft' },
      publishActiveVersion: { id: 'V-base' },
    });

    await manager.runPublishSlice(PUBLISHING);

    expect(skuMapping.updateVariantStockPolicy).not.toHaveBeenCalled();
    expect(combos.resolveExisting).not.toHaveBeenCalled();
    expect(combos.resolveCreated).not.toHaveBeenCalled();
  });

  it('조합키가 안 풀리면 그 행을 실패로 남긴다 (조용히 건너뛰지 않는다)', async () => {
    const { manager, skuMapping, updates } = makeHarness({
      bulkItems: [
        policyItemRow(
          { 'variant:c1.availabilityOverride': '품절' },
          [{ combination: 'c1', availabilityOverride: '품절' }],
          {
            draftVersionId: null,
            masterId: 'm1',
          },
        ),
      ],
      // 아무 조합도 안 풀린다(기본 빈 맵).
    });

    await manager.runPublishSlice(PUBLISHING);

    expect(skuMapping.updateVariantStockPolicy).not.toHaveBeenCalled();
    const itemUpdates = itemUpdatesOf(updates);
    expect(itemUpdates).toHaveLength(1);
    expect(itemUpdates[0].publishStatus).toBe('failed');
    // 정책이 안 걸렸는데 '발행됨'으로 보이는 것이 이 기능에서 가장 나쁜 침묵이다.
    expect(String(itemUpdates[0].publishError)).toContain('조합');
  });

  it('draft 도 정책 변경도 없는 행은 아무 것도 하지 않고 발행됨으로 도장만 찍는다', async () => {
    const { manager, versions, skuMapping, updates } = makeHarness({
      bulkItems: [publishItemRow({ draftVersionId: null })],
    });

    await manager.runPublishSlice(PUBLISHING);

    expect(versions.publishVersion).not.toHaveBeenCalled();
    expect(skuMapping.updateVariantStockPolicy).not.toHaveBeenCalled();
    // 매처(expect.any)를 object literal 안에 섞지 않는다 — 그 `any` 반환 타입이
    // no-unsafe-assignment 를 낸다(이 파일 위쪽 claim 스펙과 같은 이유).
    const itemUpdates = itemUpdatesOf(updates);
    expect(itemUpdates).toHaveLength(1);
    expect(itemUpdates[0]).toMatchObject({ publishStatus: 'published', publishError: null });
    expect(itemUpdates[0].updatedAt).toBeInstanceOf(Date);
  });

  /**
   * (리뷰 Finding 2) 신규 행 갈래는 이 태스크에서 가장 깨지기 쉬운 코드다 — 발행 시점에
   * draft 시점의 `OptionPlan` 을 `buildOptionAdd` 로 **다시 만들어** `resolveCreated` 에 넘긴다.
   * 두 페이크가 **서로 다른 맵**을 돌려주므로(`comboMap` vs `createdComboMap`) 해석기를
   * 뒤바꾸면 이 케이스가 곧장 빨개진다.
   */
  it('신규 행은 resolveCreated 로 조합을 풀고 buildOptionAdd 로 만든 plan 을 넘긴다', async () => {
    // 옵션이 실제로 있는 신규 행 — plan.valueNameByKey 가 비면 이 단언이 아무것도 안 잠근다.
    const fields = {
      'optionGroup:G1.optionName': '색상',
      'optionGroup:G1.optionSortOrder': '1',
      'optionValue:V1.optionValueName': '빨강',
      'optionValue:V1.valueSortOrder': '1',
      'variant:V1.availabilityOverride': '품절',
    };
    const optionRows = [{ optionKey: 'G1', optionValueKey: 'V1' }];

    const { manager, combos, skuMapping } = makeHarness({
      bulkItems: [
        publishItemRow({
          kind: 'create',
          draftVersionId: 'V-draft',
          masterId: 'master-new',
          payload: { fields },
          input: {
            bundle: {
              product: {},
              options: optionRows,
              variants: [{ combination: 'V1', availabilityOverride: '품절' }],
              categories: [],
              constraint: null,
            },
            present: EMPTY_PRESENT,
            errors: [],
          },
        }),
      ],
      publishDraftVersion: { id: 'V-draft', masterId: 'master-new', parentVersionId: null, status: 'draft' },
      publishActiveVersion: null, // 신규 행: 아직 active 가 없다
      // 두 해석기를 구별 가능하게 만든다 — resolveExisting 이 불리면 'WRONG' 이 나간다.
      comboMap: new Map([['V1', 'WRONG-variant']]),
      createdComboMap: new Map([['V1', 'v-created']]),
    });

    await manager.runPublishSlice(PUBLISHING);

    expect(combos.resolveExisting).not.toHaveBeenCalled();
    expect(combos.resolveCreated).toHaveBeenCalledTimes(1);
    expect(skuMapping.updateVariantStockPolicy).toHaveBeenCalledWith(
      'v-created',
      { availabilityOverride: 'manual_out_of_stock', comingSoonDate: null },
      expect.anything(),
    );

    // plan 은 `applyCreate` 가 쓰는 것과 **같은 순수 함수 산출물**이어야 한다 — 옵션값키
    // 'V1' 이 (색상, 빨강) 으로 풀리는 그 맵이 조합키 해석의 유일한 열쇠다(F7).
    const [masterIdArg, versionIdArg, fieldsArg, planArg] = combos.resolveCreated.mock.calls[0];
    expect(masterIdArg).toBe('master-new');
    expect(versionIdArg).toBe('V-draft');
    expect(fieldsArg).toEqual(fields);
    expect(planArg).toEqual(buildOptionAdd(fields, optionRows).plan);
    expect(planArg.valueNameByKey.get('V1')).toEqual({ groupName: '색상', valueName: '빨강' });
  });

  /**
   * (리뷰 Finding 1) 충돌 결정은 정책 필드에도 걸린다(스펙 §4.2). 여기서 잠그는 것은 **배선**
   * 이다 — 필터 자체의 의미론은 `bulk-session.policy.spec.ts` 가 덮는다. 짝 칸(출시예정일)이
   * 차분에 함께 있는 픽스처를 쓰는 이유: 그것이 skip 한 값이 시트에서 되살아나는 경로다.
   */
  it('충돌 결정이 skip 인 정책 셀은 발행에서도 적용되지 않는다', async () => {
    const { manager, skuMapping, updates } = makeHarness({
      bulkItems: [
        policyItemRow(
          { 'variant:c1.availabilityOverride': '품절', 'variant:c1.comingSoonDate': '' },
          [{ combination: 'c1', availabilityOverride: '품절', comingSoonDate: '' }],
          {
            draftVersionId: null,
            masterId: 'm1',
            conflictDecision: { 'variant:c1.availabilityOverride': 'skip' },
          },
        ),
      ],
      comboMap: new Map([['c1', 'v1']]),
    });

    await manager.runPublishSlice(PUBLISHING);

    expect(skuMapping.updateVariantStockPolicy).not.toHaveBeenCalled();
    // 남길 정책이 없어졌으니 이 행은 '할 일 없음' 으로 도장만 찍힌다 — 실패가 아니다.
    const itemUpdates = itemUpdatesOf(updates);
    expect(itemUpdates).toHaveLength(1);
    expect(itemUpdates[0]).toMatchObject({ publishStatus: 'published', publishError: null });
  });

  it('대상이 없으면 phase 를 published 로 마감한다 (토큰 CAS)', async () => {
    const { manager, updates } = makeHarness({ bulkItems: [] });

    await manager.runPublishSlice(PUBLISHING);

    const finish = updates.find((u) => u.values.phase === 'published')!;
    const { sql, params } = renderQuery(finish.condition);
    expect(sql.toLowerCase()).toMatch(/"lease_token"\s*=/);
    expect(sql.toLowerCase()).toContain('"cancel_requested_at" is null');
    expect(params).toContain('tok-1');
    expect(finish.values).toMatchObject({ leaseUntil: null, leaseToken: null });
  });
});

// Fix round 1 리뷰 Important 2: 이 함수를 참조하는 스펙이 0건이었다 — "세션 행이 없을 때만
// 프리필로 떨어진다"는 순서 규칙이 함정이라(순서가 바뀌면 방금 올린 파일 대신 옛 파일이
// draft 에 굳는다) 모듈 레벨 순수 함수를 export 해 직접 잠근다.
describe('imageResolverFrom', () => {
  const SESSION_IMAGE_ROWS = [{ imageKey: 'IMG-1', usage: 'main', fileId: 'file-session' }];

  function fakeItem(baseSnapshot: unknown): typeof productBulkItems.$inferSelect {
    // imageResolverFrom 은 item.baseSnapshot 만 읽는다 — 이 파일의 다른 하네스와 같은 이유로
    // 구조적으로 필요한 필드만 채운 페이크를 `as never` 로 좁힌다.
    return { baseSnapshot } as never;
  }

  it('세션 이미지 행에 (usage, imageKey) 가 있으면 그 fileId 를 준다', () => {
    const resolver = imageResolverFrom(fakeItem(null), SESSION_IMAGE_ROWS);

    expect(resolver.fileIdFor('IMG-1', 'main')).toBe('file-session');
  });

  it('세션 행에 없으면 base_snapshot.images[imageKey] 로 떨어진다', () => {
    const resolver = imageResolverFrom(
      fakeItem(snapshotOf({ images: { 'IMG-2': 'file-prefill' } })),
      SESSION_IMAGE_ROWS,
    );

    expect(resolver.fileIdFor('IMG-2', 'main')).toBe('file-prefill');
  });

  it('둘 다 있으면 세션 행이 이긴다 — 방금 올린 파일이 옛 프리필을 덮어써야 한다', () => {
    const resolver = imageResolverFrom(
      fakeItem(snapshotOf({ images: { 'IMG-1': 'file-prefill-stale' } })),
      SESSION_IMAGE_ROWS,
    );

    expect(resolver.fileIdFor('IMG-1', 'main')).toBe('file-session');
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
