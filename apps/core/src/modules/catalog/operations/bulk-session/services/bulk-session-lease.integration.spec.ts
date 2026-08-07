// Task 8(`f89c15f1d`)이 `BulkSessionJobManager` 에 `BulkDraftApplier` 를 물리면서 이 스펙의
// 임포트 그래프가 `product-masters.service.ts` 까지 늘어났고, 그 파일이 bare
// `@packages/event-contracts` 를 임포트한다. 루트 jest 설정의 moduleNameMapper 에는
// `^@packages/event-contracts/(.*)$`(하위 경로)만 있어 bare 경로는 해석되지 않는다 — 레포
// 상시 debt 다. 같은 커밋이 `bulk-session-merge.integration.spec.ts` 에는 이 우회를 이미
// 두었지만 이 파일에는 빠져 스위트가 module-not-found 로 통째로 죽어 있었다.
//
// 값이 필요한 곳은 클래스 정의 시점에 평가되는 `@InjectStreamPublisher(PRODUCT_STREAM.topic.topic)`
// 데코레이터 인자뿐이다 — 이 스위트는 그 서비스들을 인스턴스화하지도 부르지도 않는다
// (`BulkSessionJobManager` 에 applier 로 `undefined as never` 를 넘긴다).
jest.mock(
  '@packages/event-contracts',
  () => ({
    PRODUCT_STREAM: { topic: { topic: 'products.events.v1' }, aggregateType: 'Product' },
  }),
  { virtual: true },
);

import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DbService } from '@app/db';
import { catalogSchema, type PimSchema } from '../../../schema/catalog.schema';
import { BulkSessionJobManager, MAX_CONSECUTIVE_BULK_FAILURES } from './bulk-session-job.manager';
import { BulkVariantCodeChecker } from './bulk-variant-code.checker';
import { buildFormWorkbook } from './form-export.workbook';
import type { PrefillRow, PrefillWorkbookData } from './form-export.types';

/**
 * 일괄 세션 lease 소유권·취소·`payload IS NULL` 불변식을 **진짜 Postgres** 에 대고 구동한다.
 *
 * 이 스펙이 존재하는 이유: `product_import_sessions` 의 lease 소유권이 세 번 연속으로
 * 깨졌는데 세 번 다 목 기반 단위 스펙에는 보이지 않았다(각각 (1) 생존검사를 소유권검사로
 * 착각, (2) 절대 일치할 수 없는 타임스탬프 등호 CAS, (3) 드라이버가 직렬화 못하는 값
 * 바인딩). `BulkSessionJobManager.claim` 은 그 claim 을 컬럼만 바꿔 그대로 가져왔으므로
 * (스펙 §3.11 이 DRY 에 우선한다는 사용자 판정), 검증도 1단계
 * `form-export-job-lease.integration.spec.ts` 를 그대로 본뜬다 — 여기서는 실제 SQL 이
 * 실제 행에 어떻게 작용하는지만 본다.
 *
 * **실행**: 이 스위트 전용 scratch DB(`bulk_stage2_scratch`)에 core 마이그레이션을 올린 뒤
 * 그 DB 를 가리키는 DATABASE_URL 로 돌린다 — `dev_core` 에는 이 브랜치와 무관한 보류 중인
 * 마이그레이션이 있어 거기서 마이그레이션을 실행하면 안 된다.
 *
 * **격리**: 일회용 스키마를 만들고 admin/두 워커 커넥션 전부의 search_path 를 거기로
 * 고정한다 — `SET search_path` 문 대신 접속 startup 파라미터로 넘긴다(postgres.js 가
 * 물리 재연결하면 `SET` 은 조용히 public 으로 되돌아간다). `claim()` 의 SQL 에는 세션을
 * 골라내는 필터가 없다(가장 오래된 자격 세션을 집는 게 본래 동작이다) — public 스키마에
 * 붙이면 이 스위트가 남의 대기 세션을 집어 running 으로 만들어놓고 되돌리지 않는다.
 * 스키마를 갈아버리면 애초에 그 행이 안 보이므로 문제 자체가 사라진다
 * (선례: form-export-job-lease.integration.spec.ts:26-32).
 * `afterAll` 이 `public.product_bulk_sessions` 가 0행인 것을 실측해 격리가 진짜 성립했음을
 * 남긴다 — 격리가 깨지면 그 단정이 먼저 터진다.
 *
 * **협력자 스텁**: 이 스위트는 lease·취소·재검증 방지만 본다. 그래서 `renderMaster`
 * (수정 행의 '현재 active' 렌더)와 `getCategoryTree` 는 스텁이고, 모든 픽스처 행은
 * `kind='create'` 다 — 실 상품/실 병합은 `bulk-session-merge.integration.spec.ts` 가
 * 실 Postgres 픽스처로 따로 증명한다. `download` 만 진짜 워크북 버퍼를 돌려준다.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_BULK_SESSION_DB === '1' && !DATABASE_URL) {
  throw new Error('DATABASE_URL is required for the bulk session lease integration suite.');
}
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const LEASE_MS = 30_000;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** 워크북에 담을 신규 상품 행. 접합기가 프리필 키를 모르므로 전부 `kind='create'` 가 된다. */
const NEW_ROW_OK: PrefillRow = {
  rowKey: 'N-000001',
  name: '신규 티셔츠',
  basePrice: '12000',
  salesStartDate: '2026-09-01 10:30',
};
/** 상품명·판매가가 비어 행 검증에서 오류가 나는 행. `payload` 불변식 단정에 쓴다. */
const NEW_ROW_BAD: PrefillRow = { rowKey: 'N-000002', name: '', basePrice: '' };
const NEW_ROW_THIRD: PrefillRow = { rowKey: 'N-000003', name: '신규 모자', basePrice: '9000' };

/** exportId 를 비운 워크북 = 신규 전용 세션. 파서가 빈 메타 셀을 null 로 읽는다. */
function newOnlyWorkbook(products: PrefillRow[], exportId = ''): Promise<Buffer> {
  const data: PrefillWorkbookData = {
    exportId,
    products,
    options: [],
    variants: [],
    categories: [],
    constraints: [],
    images: [],
    categoryPaths: [],
  };
  return buildFormWorkbook(data);
}

/**
 * 일회용 스키마로 search_path 가 고정된 커넥션. 이유는 위 헤더 코멘트 참조.
 *
 * **이 스위트의 모든 커넥션(admin 포함)이 이걸 통과해야 한다.** 옵션을 호출부에서 다시
 * 적으면 격리의 핵심인 `connection: { search_path }` 가 두 곳에 흩어지고, 한쪽만 고치는
 * 순간 그 커넥션이 조용히 public 으로 샌다.
 */
function connect(url: string, schema: string): postgres.Sql {
  return postgres(url, { max: 1, prepare: false, connection: { search_path: schema } });
}

/**
 * 워커 하나를 흉내낸다 — 자기 커넥션과 자기 BulkSessionJobManager 를 가진다. 두 개를
 * 만들면 "롤링 배포로 태스크가 잠시 둘" 인 상황이 그대로 재현된다.
 *
 * `config` 는 **일부러 가변 객체**다. `ConfigService.get` 은 내부 config 객체를 매 호출
 * 읽으므로(캐시는 기본 꺼져 있다), 슬라이스 크기를 테스트마다 바꿔 "1행 처리 후 취소"
 * 같은 경계를 타이머 없이 결정적으로 만들 수 있다. 실제로 적용됐는지는 그 테스트가
 * "정확히 1행만 payload 가 찼다"로 직접 확인한다.
 */
function makeWorkerLike(client: postgres.Sql) {
  const db = drizzle(client, { schema: catalogSchema });
  const dbService = {
    db,
    run: <T>(fn: (t: never) => Promise<T>, tx?: never): Promise<T> =>
      tx ? fn(tx) : db.transaction((t) => fn(t as never)),
  } as unknown as DbService<PimSchema>;

  // 협력자 참조를 낱개 jest.fn 으로 돌려준다 — `{ download } as FormExportFileClient` 처럼
  // 인터페이스 타입을 통째로 씌우면 `expect(a.download)...` 같은 메서드 참조가
  // `@typescript-eslint/unbound-method` 에 걸린다. 생성자에 넘길 때만 `as never` 로 좁힌다.
  const download = jest.fn((): Promise<Buffer> => newOnlyWorkbook([NEW_ROW_OK]));
  const renderMaster = jest.fn((): Promise<null> => Promise.resolve(null));
  const getCategoryTree = jest.fn((): Promise<{ categories: [] }> => Promise.resolve({ categories: [] }));

  const config: Record<string, string> = {
    PRODUCT_BULK_LEASE_MS: String(LEASE_MS),
    PRODUCT_BULK_VALIDATE_SLICE: '20',
  };

  // (Task 8) BulkSessionJobManager 생성자에 BulkDraftApplier 가 늘었다 — 이 스위트는
  // lease·취소·재검증 방지만 보고(위 헤더 코멘트) drafting 슬라이스는 부르지 않으므로
  // 실제 applier 를 세우지 않는다. (Task 3) ProductVersionsService 도 같은 이유로
  // `undefined as never` 다 — 이 스위트는 발행 슬라이스를 부르지 않는다.
  // (Task 11) BulkVariantCodeChecker 는 이 스위트가 **실제로 부르는** 검증 슬라이스의 마감
  // 분기(review 직전)에서 매번 불린다 — `undefined as never` 를 넘기면 lease 시나리오
  // 자체가 TypeError 로 죽는다. 픽스처 행에는 variantCode 를 주장하는 조합 시트가 없어
  // (NEW_ROW_* 는 상품 시트뿐이다) 매 호출이 안전하게 0건으로 끝나므로, 진짜 인스턴스를
  // 같은 dbService 에 물려 real Postgres 를 그대로 타게 한다.
  const manager = new BulkSessionJobManager(
    dbService,
    { download } as never,
    { renderMaster } as never,
    { getCategoryTree } as never,
    undefined as never,
    undefined as never,
    new ConfigService(config),
    new BulkVariantCodeChecker(dbService),
    // (Task 8) 조합키 해석기·판매정책 서비스는 발행 슬라이스에서만 불린다 — 이 스위트는
    // 그 슬라이스를 부르지 않으므로 위 applier·versions 와 같은 이유로 비워 둔다.
    undefined as never,
    undefined as never,
  );
  return { manager, download, renderMaster, getCategoryTree, config };
}

describeIfDb('일괄 세션 lease 소유권·취소 (DB 통합)', () => {
  jest.setTimeout(120_000);

  const schemaName = `bs_lease_${randomUUID().replaceAll('-', '')}`;
  let admin: postgres.Sql;
  let clientA: postgres.Sql;
  let clientB: postgres.Sql;
  let a: ReturnType<typeof makeWorkerLike>;
  let b: ReturnType<typeof makeWorkerLike>;

  beforeAll(async () => {
    const bootstrap = postgres(DATABASE_URL as string, { max: 1, prepare: false });
    await bootstrap.unsafe(`CREATE SCHEMA "${schemaName}"`);
    await bootstrap.end();

    admin = connect(DATABASE_URL as string, schemaName);
    // public 의 실제 DDL 을 그대로 복제한다 — 손으로 옮겨 적으면 스키마가 갈라진다.
    // (enum 컬럼 타입은 생성 시점에 public 의 타입 OID 로 해석되므로 그대로 따라온다.
    // LIKE 는 외래키를 복제하지 않는다 — 이 스위트는 FK 를 검증 대상으로 삼지 않는다.)
    await admin.unsafe(`CREATE TABLE product_bulk_sessions (LIKE public.product_bulk_sessions INCLUDING ALL)`);
    await admin.unsafe(`CREATE TABLE product_bulk_items (LIKE public.product_bulk_items INCLUDING ALL)`);
    await admin.unsafe(`CREATE TABLE product_bulk_images (LIKE public.product_bulk_images INCLUDING ALL)`);

    clientA = connect(DATABASE_URL as string, schemaName);
    clientB = connect(DATABASE_URL as string, schemaName);
    a = makeWorkerLike(clientA);
    b = makeWorkerLike(clientB);
  });

  afterAll(async () => {
    // 격리가 진짜 성립했다는 실측 — 이 스위트의 어떤 INSERT/UPDATE 도 public 에 닿지
    // 않았어야 한다. 격리가 깨졌다면 여기서 0 이 아니게 되고, 그때는 남의 대기 세션을
    // 건드렸을 가능성도 함께 열린다.
    const [{ count }] = (await admin`SELECT count(*)::int AS count FROM public.product_bulk_sessions`) as unknown as [
      { count: number },
    ];
    expect(count).toBe(0);

    await admin?.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
    await Promise.all([clientA?.end(), clientB?.end(), admin?.end()]);
  });

  beforeEach(async () => {
    // `LIKE public.x INCLUDING ALL` 은 외래키(ON DELETE cascade 포함)를 복제하지 않으므로
    // items/images 를 sessions 와 별개로 직접 비운다 — 안 그러면 이전 테스트의 행이 샌다.
    await admin`DELETE FROM product_bulk_items`;
    await admin`DELETE FROM product_bulk_images`;
    await admin`DELETE FROM product_bulk_sessions`;
    for (const worker of [a, b]) {
      // `mockClear` 로는 부족하다 — `mockResolvedValueOnce` 로 예약된 값은 `mockReset` 만
      // 지운다(jest 문서). 소비되지 않은 once 값이 다음 테스트로 새는 사고가 1단계 스펙
      // 초안에서 실제로 났다.
      worker.download.mockReset().mockImplementation(() => newOnlyWorkbook([NEW_ROW_OK]));
      worker.renderMaster.mockReset().mockImplementation(() => Promise.resolve(null));
      worker.getCategoryTree.mockReset().mockImplementation(() => Promise.resolve({ categories: [] }));
      worker.config.PRODUCT_BULK_VALIDATE_SLICE = '20';
    }
  });

  /** claim 이 집을 수 있는 `uploaded` 세션 하나. exportId 는 NULL — 신규 전용 세션이다. */
  async function seedSession(overrides: { exportId?: string } = {}): Promise<string> {
    const id = randomUUID();
    await admin`
      INSERT INTO product_bulk_sessions (id, name, export_id, uploaded_by, file_name, source_file_id, phase)
      VALUES (${id}, ${'스모크'}, ${overrides.exportId ?? null}, ${randomUUID()}, ${'양식.xlsx'},
              ${randomUUID()}, 'uploaded')
    `;
    return id;
  }

  async function readSession(sessionId: string) {
    const [row] = await admin`
      SELECT phase, phase_error, total_rows, lease_token, lease_until, consecutive_failures, cancel_requested_at,
             (lease_until > NOW()) AS is_live
        FROM product_bulk_sessions
       WHERE id = ${sessionId}
    `;
    // postgres.js 의 태그드 템플릿은 행 타입을 좁혀주지 않는다 — select 절 모양으로 캐스팅한다.
    return row as unknown as {
      phase: string;
      phase_error: string | null;
      total_rows: number;
      lease_token: string | null;
      lease_until: Date | null;
      consecutive_failures: number;
      cancel_requested_at: Date | null;
      is_live: boolean | null;
    };
  }

  async function readItems(sessionId: string) {
    const rows = await admin`
      SELECT row_key, kind, status, payload, input, conflict, error_message
        FROM product_bulk_items
       WHERE session_id = ${sessionId}
       ORDER BY row_key
    `;
    return rows as unknown as Array<{
      row_key: string;
      kind: string;
      status: string;
      payload: { fields: Record<string, string> } | null;
      input: { present: Record<string, string[]>; bundle: unknown; errors: unknown[] };
      conflict: Record<string, unknown> | null;
      error_message: string | null;
    }>;
  }

  /** lease 를 특정 토큰으로 다시 심는다 — claim 을 거치지 않고 좀비/후임을 구성할 때 쓴다. */
  async function grantLease(sessionId: string, token: string): Promise<void> {
    await admin`
      UPDATE product_bulk_sessions
         SET lease_token = ${token}::uuid, lease_until = NOW() + interval '30 seconds'
       WHERE id = ${sessionId}
    `;
  }

  it('클레임은 UUIDv7 토큰을 발급하고 lease 를 미래로 민다', async () => {
    const sessionId = await seedSession();

    const claimed = await a.manager.claim();

    expect(claimed).not.toBeNull();
    expect(claimed!.sessionId).toBe(sessionId);
    expect(claimed!.phase).toBe('uploaded');
    expect(claimed!.leaseToken).toMatch(UUID_V7);

    const row = await readSession(sessionId);
    // DB 에 실제로 박힌 토큰이 우리가 들고 있는 값과 같아야 한다 — 이후 CAS 가 전부 이 등식에 걸린다.
    expect(row.lease_token).toBe(claimed!.leaseToken);
    expect(row.is_live).toBe(true);
  });

  it('claim 은 대기 세션이 없으면 null 이다', async () => {
    expect(await a.manager.claim()).toBeNull();
  });

  it('lease 가 살아 있는 세션은 두 번째 워커가 못 잡는다', async () => {
    const sessionId = await seedSession();

    const first = await a.manager.claim();
    expect(first).not.toBeNull();

    expect(await b.manager.claim()).toBeNull();
    expect((await readSession(sessionId)).lease_token).toBe(first!.leaseToken);
  });

  it('lease 가 만료되면 후임이 이어받고 토큰이 바뀐다 (재개 경로)', async () => {
    const sessionId = await seedSession();
    const first = await a.manager.claim();
    expect(first).not.toBeNull();

    await admin`UPDATE product_bulk_sessions SET lease_until = NOW() - interval '1 minute' WHERE id = ${sessionId}`;

    const second = await b.manager.claim();
    expect(second).not.toBeNull();
    expect(second!.sessionId).toBe(sessionId);
    // 인수한 워커는 **새 토큰**을 발급한다. 같은 토큰이면 펜싱이 성립하지 않는다.
    expect(second!.leaseToken).not.toBe(first!.leaseToken);
    expect((await readSession(sessionId)).lease_token).toBe(second!.leaseToken);
  });

  it('cancel_requested_at 이 찍힌 세션은 claim 되지 않는다', async () => {
    const sessionId = await seedSession();
    await admin`UPDATE product_bulk_sessions SET cancel_requested_at = NOW() WHERE id = ${sessionId}`;

    expect(await a.manager.claim()).toBeNull();
  });

  it('파싱 슬라이스가 items 를 적재하고 validating 으로 민 뒤 lease 를 놓는다', async () => {
    const sessionId = await seedSession();
    a.download.mockResolvedValueOnce(await newOnlyWorkbook([NEW_ROW_OK, NEW_ROW_BAD]));
    const claimed = await a.manager.claim();

    await a.manager.runParseSlice(claimed!);

    const row = await readSession(sessionId);
    expect(row.phase).toBe('validating');
    expect(row.total_rows).toBe(2);
    // lease 를 여기서 놓는 것이 설계다 — 다음 틱이 곧바로 검증 슬라이스로 이어받는다.
    expect(row.lease_token).toBeNull();
    expect(row.lease_until).toBeNull();

    const items = await readItems(sessionId);
    expect(items.map((i) => i.row_key)).toEqual(['N-000001', 'N-000002']);
    expect(items.every((i) => i.kind === 'create')).toBe(true);
    // `payload IS NULL` 이 "아직 검증 안 됨"의 유일한 표시다 — 파싱 직후엔 전부 NULL 이다.
    expect(items.every((i) => i.payload === null)).toBe(true);
  });

  it('input.present 는 jsonb 왕복 후에도 열 이름을 담은 배열이다', async () => {
    // `present` 를 Set 으로 담으면 `JSON.stringify(new Set(['a']))` 가 `{}` 라 왕복 후
    // "존재한 열이 하나도 없다"가 되고, 모든 수정 행의 변경분이 통째로 사라진다.
    // 왕복 후에도 값이 남아 있는지를 실 jsonb 컬럼에서 직접 본다.
    const sessionId = await seedSession();
    const claimed = await a.manager.claim();
    await a.manager.runParseSlice(claimed!);

    const [item] = await readItems(sessionId);
    expect(Array.isArray(item.input.present.products)).toBe(true);
    expect(item.input.present.products).toContain('name');
    expect(item.input.present.products).toContain('brand');
    // 양식 워크북은 6개 시트를 모두 쓰므로 나머지 시트의 present 도 비어 있으면 안 된다.
    expect(item.input.present.categories).toContain('categoryPath');
    expect(item.input.present.constraints).toContain('lifetimeQuantityLimit');
  });

  it('세션의 export_id 가 NULL 인데 워크북에 exportId 가 있으면 세션을 실패시킨다', async () => {
    // 접수 이후 양식 잡이 만료 삭제되어 FK 가 SET NULL 로 끊긴 상태다. 이걸 "신규 전용
    // 세션"으로 읽으면 프리필된 행 전량이 신규 상품으로 재분류돼 카탈로그가 통째로
    // 중복 생성된다 — 이 브랜치가 명시적으로 막은 사고다.
    const sessionId = await seedSession();
    a.download.mockResolvedValueOnce(await newOnlyWorkbook([NEW_ROW_OK], randomUUID()));
    const claimed = await a.manager.claim();

    await a.manager.runParseSlice(claimed!);

    const row = await readSession(sessionId);
    expect(row.phase).toBe('failed');
    expect(row.phase_error).toContain('양식을 다시 받아');
    expect(await readItems(sessionId)).toHaveLength(0);
  });

  it('검증이 끝나면 review 로 넘어가고, 오류 행도 payload 가 non-null 이라 다시 검증되지 않는다', async () => {
    const sessionId = await seedSession();
    a.download.mockResolvedValueOnce(await newOnlyWorkbook([NEW_ROW_OK, NEW_ROW_BAD]));
    await a.manager.runParseSlice((await a.manager.claim())!);

    // 검증 슬라이스 1회 — 두 행 모두 처리하고 lease 를 놓는다.
    await a.manager.runValidateSlice((await a.manager.claim())!);

    const items = await readItems(sessionId);
    const ok = items.find((i) => i.row_key === 'N-000001')!;
    const bad = items.find((i) => i.row_key === 'N-000002')!;
    expect(ok.status).toBe('pending');
    expect(ok.payload).not.toBeNull();
    // 오류가 났다고 payload 를 NULL 로 두면 그 행이 영원히 다시 검증돼 슬라이스가 제자리를 돈다.
    expect(bad.status).toBe('invalid');
    expect(bad.payload).not.toBeNull();
    expect(bad.error_message).toContain('상품명');

    // 남은 미검증 행이 없으므로 다음 슬라이스가 세션을 review 로 민다.
    const second = await a.manager.claim();
    expect(second).not.toBeNull();
    await a.manager.runValidateSlice(second!);

    const row = await readSession(sessionId);
    expect(row.phase).toBe('review');
    expect(row.lease_token).toBeNull();

    // 두 번째 슬라이스가 두 행을 다시 집었다면 마감이 아니라 재검증이 일어났을 것이고,
    // phase 는 validating 에 머물렀을 것이다. 상태도 그대로다.
    const after = await readItems(sessionId);
    expect(after.map((i) => i.status)).toEqual(['pending', 'invalid']);
    // review 세션은 claim 후보가 아니다 — 여기서 루프가 끝난다.
    expect(await a.manager.claim()).toBeNull();
  });

  it('payload.fields 의 값은 jsonb 왕복 후에도 전부 문자열이다', async () => {
    // v3 3단계는 여기서 Date 로 죽었다 — 워크북 셀을 문자열로 굳히지 않으면 드라이버가
    // 직렬화하지 못하거나, 왕복 후 타입이 바뀌어 문자열 등호 비교가 조용히 어긋난다.
    //
    // **`input` 전체를 같이 주장하지 않는다**: `input.errors[].rowNumber` 는 설계상 숫자라
    // "전부 문자열"이 애초에 성립하지 않는다. `input` 쪽 왕복은 성질별로 따로 잠근다 —
    // `present` 배열은 위 'input.present 는 …' 테스트가, 그 배열이 diff 에 실제로 미치는
    // 영향은 merge 스펙의 '열을 통째로 지운 파일 …' 이 본다.
    const sessionId = await seedSession();
    await a.manager.runParseSlice((await a.manager.claim())!);
    await a.manager.runValidateSlice((await a.manager.claim())!);

    const [item] = await readItems(sessionId);
    expect(item.payload).not.toBeNull();
    const values = Object.values(item.payload!.fields);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) expect(typeof value).toBe('string');
    // 날짜 셀이 실제로 담겨 있는지도 본다 — 전부 빈 문자열이면 위 루프가 공허하다.
    expect(item.payload!.fields['product.salesStartDate']).toBe('2026-09-01 10:30');
  });

  it('옛 토큰으로는 마감하지 못한다 — 좀비가 후임의 lease 와 phase 를 건드리지 않는다', async () => {
    const sessionId = await seedSession();
    await a.manager.runParseSlice((await a.manager.claim())!);

    // 좀비(A)가 잡았다가 lease 가 만료되고, 후임(B)이 인수해 **지금 처리 중**이다.
    const zombie = await a.manager.claim();
    expect(zombie).not.toBeNull();
    await admin`UPDATE product_bulk_sessions SET lease_until = NOW() - interval '1 minute' WHERE id = ${sessionId}`;
    const successor = await b.manager.claim();
    expect(successor).not.toBeNull();
    expect(successor!.leaseToken).not.toBe(zombie!.leaseToken);

    // 후임이 행을 다 검증했지만 아직 lease 를 쥔 채 다음 슬라이스로 넘어가기 직전이라고 하자.
    await admin`UPDATE product_bulk_items SET payload = '{"fields":{}}'::jsonb WHERE session_id = ${sessionId}`;

    // 좀비가 뒤늦게 깨어나 슬라이스를 돈다. 미검증 행이 0개로 보이므로 마감으로 직행하는데,
    // 마감 CAS 가 0행을 매치해야 한다.
    await a.manager.runValidateSlice(zombie!);

    const row = await readSession(sessionId);
    // CAS 가 없었다면 phase 가 review 로 도장 찍히고 **후임의 lease 까지 지워진다** —
    // 후임은 그때부터 자기 것이 아닌 세션을 계속 처리하게 된다.
    expect(row.phase).toBe('validating');
    expect(row.lease_token).toBe(successor!.leaseToken);
    expect(row.is_live).toBe(true);

    // 후임이 같은 일을 하면 정상적으로 마감된다 — 위 실패가 "아무도 마감 못 한다"가 아님을 보인다.
    await b.manager.runValidateSlice(successor!);
    const finished = await readSession(sessionId);
    expect(finished.phase).toBe('review');
    expect(finished.lease_token).toBeNull();
  });

  it('검증 슬라이스 중 취소가 들어오면 남은 행을 건드리지 않는다', async () => {
    const sessionId = await seedSession();
    a.download.mockResolvedValueOnce(await newOnlyWorkbook([NEW_ROW_OK, NEW_ROW_BAD, NEW_ROW_THIRD]));
    await a.manager.runParseSlice((await a.manager.claim())!);

    // 슬라이스를 1행으로 줄여 "1행 처리 후 취소"라는 경계를 타이머 없이 결정적으로 만든다.
    a.config.PRODUCT_BULK_VALIDATE_SLICE = '1';
    await a.manager.runValidateSlice((await a.manager.claim())!);
    expect((await readItems(sessionId)).filter((i) => i.payload !== null)).toHaveLength(1);

    // 다음 워커가 lease 를 쥔 상태에서 취소가 들어온다.
    const holding = await a.manager.claim();
    expect(holding).not.toBeNull();
    await admin`UPDATE product_bulk_sessions SET cancel_requested_at = NOW(), phase = 'canceled' WHERE id = ${sessionId}`;

    a.config.PRODUCT_BULK_VALIDATE_SLICE = '20';
    await a.manager.runValidateSlice(holding!);

    // 나머지 2행은 손대지 않았고, 취소 phase 가 review 로 덮이지도 않았다.
    const items = await readItems(sessionId);
    expect(items.filter((i) => i.payload === null)).toHaveLength(2);
    const row = await readSession(sessionId);
    expect(row.phase).toBe('canceled');
    // 슬라이스가 중단하며 lease 를 놓는다 — 붙잡고 있으면 취소 정리가 만료를 기다려야 한다.
    expect(row.lease_token).toBeNull();
    expect(await a.manager.claim()).toBeNull();
  });

  it('연속 실패가 상한에 닿으면 failed 로 확정되고 claim 후보에서 빠진다', async () => {
    const sessionId = await seedSession();
    const claimed = await a.manager.claim();
    expect(claimed).not.toBeNull();

    for (let i = 0; i < MAX_CONSECUTIVE_BULK_FAILURES; i += 1) {
      await a.manager.recordJobError(sessionId, `반복 오류 ${i}`);
    }

    const row = await readSession(sessionId);
    expect(row.consecutive_failures).toBe(MAX_CONSECUTIVE_BULK_FAILURES);
    expect(row.phase).toBe('failed');
    expect(row.lease_token).toBeNull();
    expect(await a.manager.claim()).toBeNull();
  });

  it('레인을 벗어난 세션은 좀비의 recordJobError 가 다시 실패로 끌어내리지 못한다', async () => {
    const sessionId = await seedSession();
    await admin`UPDATE product_bulk_sessions SET phase = 'review' WHERE id = ${sessionId}`;

    await a.manager.recordJobError(sessionId, '뒤늦게 도착한 예외');

    const row = await readSession(sessionId);
    expect(row.phase).toBe('review');
    expect(row.consecutive_failures).toBe(0);
    expect(row.phase_error).toBeNull();
  });

  it('정상 종료한 슬라이스의 리셋이 연속 실패 카운터를 0 으로 되돌린다', async () => {
    const sessionId = await seedSession();
    await a.manager.claim();
    await a.manager.recordJobError(sessionId, '일시적 오류');
    expect((await readSession(sessionId)).consecutive_failures).toBe(1);

    await a.manager.clearConsecutiveFailures(sessionId);

    expect((await readSession(sessionId)).consecutive_failures).toBe(0);
  });

  it('좀비 토큰으로는 lease 를 갱신하지 못해 슬라이스가 즉시 멈춘다', async () => {
    const sessionId = await seedSession();
    await a.manager.runParseSlice((await a.manager.claim())!);

    // 후임이 lease 를 쥐고 있고, 좀비는 자기 토큰만 들고 깨어났다.
    const successorToken = randomUUID();
    await grantLease(sessionId, successorToken);
    const zombieToken = randomUUID();

    await a.manager.runValidateSlice({ sessionId, leaseToken: zombieToken, phase: 'validating' });

    // 미검증 행이 남아 있는데 한 행도 처리하지 않았다 — `lease_until > NOW()` 같은 생존
    // 검사였다면 후임이 방금 민 lease 도 미래라 그대로 통과해 같은 행을 나란히 처리했다.
    const items = await readItems(sessionId);
    expect(items.every((i) => i.payload === null)).toBe(true);
    expect((await readSession(sessionId)).lease_token).toBe(successorToken);
  });
});
