import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DbService } from '@app/db';
import { catalogSchema, type PimSchema } from '../../../schema/catalog.schema';
import {
  FORM_EXPORT_RETRY_DELAY_MS,
  FormExportJobManager,
  MAX_CONSECUTIVE_EXPORT_FAILURES,
} from './form-export-job.manager';
import type { SnapshotItem } from './form-export.snapshot.reader';
import type { PrefillBundle, PrefillWorkbookData } from './form-export.types';

/**
 * lease 소유권(claim → 마감)을 **진짜 Postgres** 에 대고 구동한다.
 *
 * 이 스펙이 존재하는 이유: `product_import_sessions` 의 lease 소유권이 세 번 연속으로
 * 깨졌는데 세 번 다 목 기반 단위 스펙에는 보이지 않았다(각각 (1) 생존검사를 소유권검사로
 * 착각, (2) 절대 일치할 수 없는 타임스탬프 등호 CAS, (3) 드라이버가 직렬화 못하는 값
 * 바인딩). `FormExportJobManager.claim` 은 그 claim 을 컬럼만 바꿔 그대로 가져왔으므로,
 * 검증도 `product-import-job-lease.integration.spec.ts` 를 그대로 본뜬다 — 여기서는 실제
 * SQL 이 실제 행에 어떻게 작용하는지만 본다.
 *
 * **실행**: 이 스위트 전용 scratch DB(`sdd_stage1_scratch`)에 core 마이그레이션을 올린 뒤
 * 그 DB 를 가리키는 DATABASE_URL 로 돌린다 — dev_core 에는 이 태스크와 무관한 보류 중인
 * destructive 마이그레이션이 있어 여기서 마이그레이션을 실행하면 안 된다
 * (form-export-snapshot.integration.spec.ts 와 같은 스크래치 DB, 같은 이유).
 *
 * **격리**: 일회용 스키마를 만들고 admin/두 워커 커넥션 전부의 search_path 를 거기로
 * 고정한다 — `SET search_path` 문 대신 접속 startup 파라미터로 넘긴다(postgres.js 가
 * 물리 재연결하면 `SET` 은 조용히 public 으로 되돌아간다). `claim()` 의 SQL 에는 잡을
 * 골라내는 필터가 없다(가장 오래된 자격 잡을 집는 게 본래 동작이다) — public 스키마에
 * 붙이면 이 스위트가 남의 대기 잡을 집어 running 으로 만들어놓고 되돌리지 않는다.
 * 스키마를 갈아버리면 애초에 그 행이 안 보이므로 문제 자체가 사라진다
 * (선례: product-import-job-lease.integration.spec.ts:33-39).
 *
 * **협력자 스텁**: `FormExportSnapshotReader`/`FormExportFileClient` 는 이 스위트가
 * 검증하는 대상이 아니다(Task 5/6 스펙이 이미 검증했다). 하지만 임포트의
 * `runCommitSlice`(pending 0 이면 협력자를 아예 안 부르고 곧장 마감)와 달리, 이 매니저의
 * `runExport` 는 **항상**(요청 masterId 가 0개여도) 스냅샷을 만들고 파일을 업로드한다 —
 * 워크북이 부분 산출물 없는 파일 하나이기 때문이다. 그래서 product-import-job-lease 처럼
 * `undefined as unknown as X` 로 비워둘 수 없고, 최소 동작 스텁이 필요하다.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_FORM_EXPORT_DB === '1' && !DATABASE_URL) {
  throw new Error('DATABASE_URL is required for the form export job lease integration suite.');
}
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const LEASE_MS = 30_000;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const STUB_FILE_ID = '00000000-0000-4000-8000-000000000abc';
// 좀비/후임 구분용 — Important 2 (아래 '옛 토큰으로는 마감하지 못한다' 참조)가 두 워커의
// 결과를 fileId 로도 구분해야 하므로 기본 STUB_FILE_ID 와 다른 두 값을 따로 둔다.
const STUB_FILE_ID_A = '00000000-0000-4000-8000-00000000000a';
const STUB_FILE_ID_B = '00000000-0000-4000-8000-00000000000b';

const EMPTY_PREFILL_DATA: PrefillWorkbookData = {
  exportId: '',
  products: [],
  options: [],
  variants: [],
  categories: [],
  constraints: [],
  images: [],
  categoryPaths: [],
};

/** 이 스위트는 lease 소유권만 본다 — 스냅샷 값은 무관하다. `SnapshotItem.snapshot` 필수 필드용 최소 스텁. */
const EMPTY_SNAPSHOT: PrefillBundle = {
  product: {},
  options: [],
  variants: [],
  categories: [],
  constraint: null,
  images: {},
};

/**
 * 일회용 스키마로 search_path 가 고정된 커넥션. 이유는 위 헤더 코멘트 참조.
 */
function connect(url: string, schema: string): postgres.Sql {
  return postgres(url, { max: 1, prepare: false, connection: { search_path: schema } });
}

/**
 * 워커 하나를 흉내낸다 — 자기 커넥션과 자기 FormExportJobManager 를 가진다. 두 개를
 * 만들면 "롤링 배포로 태스크가 잠시 둘" 인 상황이 그대로 재현된다.
 */
function makeWorkerLike(client: postgres.Sql) {
  const db = drizzle(client, { schema: catalogSchema });
  const dbService = {
    db,
    run: <T>(fn: (t: never) => Promise<T>, tx?: never): Promise<T> =>
      tx ? fn(tx) : db.transaction((t) => fn(t as never)),
  } as unknown as DbService<PimSchema>;

  // buildPrefill/upload 참조를 낱개 jest.fn 으로 돌려준다 — `{ buildPrefill } as
  // FormExportSnapshotReader` 처럼 인터페이스 타입을 통째로 씌우면 `expect(a.buildPrefill)...`
  // 같은 메서드 참조가 `@typescript-eslint/unbound-method` 에 걸린다(클래스 메서드로 보여
  // `this` 바인딩을 걱정하는 규칙). 생성자에 넘길 때만 `as never` 로 좁힌다.
  const buildPrefill = jest.fn(
    (): Promise<{ data: PrefillWorkbookData; items: SnapshotItem[] }> =>
      Promise.resolve({ data: EMPTY_PREFILL_DATA, items: [] }),
  );
  const upload = jest.fn((): Promise<{ fileId: string }> => Promise.resolve({ fileId: STUB_FILE_ID }));

  const manager = new FormExportJobManager(
    dbService,
    { buildPrefill } as never,
    { upload } as never,
    new ConfigService({ FORM_EXPORT_LEASE_MS: String(LEASE_MS) }),
  );
  return { manager, buildPrefill, upload };
}

describeIfDb('form export 잡 lease 소유권 (DB 통합)', () => {
  jest.setTimeout(120_000);

  const schemaName = `fe_lease_${randomUUID().replaceAll('-', '')}`;
  let admin: postgres.Sql;
  let clientA: postgres.Sql;
  let clientB: postgres.Sql;
  let a: ReturnType<typeof makeWorkerLike>;
  let b: ReturnType<typeof makeWorkerLike>;

  beforeAll(async () => {
    // 스키마 자체는 이름이 이미 한정돼 있으니 search_path 없이도 만들 수 있다.
    const bootstrap = postgres(DATABASE_URL as string, { max: 1, prepare: false });
    await bootstrap.unsafe(`CREATE SCHEMA "${schemaName}"`);
    await bootstrap.end();

    admin = postgres(DATABASE_URL as string, { max: 1, prepare: false, connection: { search_path: schemaName } });
    // public 의 실제 DDL 을 그대로 복제한다 — 손으로 옮겨 적으면 스키마가 갈라진다.
    // (enum 컬럼 타입은 생성 시점에 public 의 타입 OID 로 해석되므로 그대로 따라온다.
    // LIKE 는 외래키를 복제하지 않는다 — 이 스위트는 FK 를 검증 대상으로 삼지 않는다.)
    await admin.unsafe(`CREATE TABLE product_form_exports (LIKE public.product_form_exports INCLUDING ALL)`);
    await admin.unsafe(`CREATE TABLE product_form_export_items (LIKE public.product_form_export_items INCLUDING ALL)`);

    clientA = connect(DATABASE_URL as string, schemaName);
    clientB = connect(DATABASE_URL as string, schemaName);
    a = makeWorkerLike(clientA);
    b = makeWorkerLike(clientB);
  });

  afterAll(async () => {
    await admin?.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
    await Promise.all([clientA?.end(), clientB?.end(), admin?.end()]);
  });

  beforeEach(async () => {
    // 둘 다 지운다 — `LIKE public.x INCLUDING ALL` 은 외래키(ON DELETE cascade 포함)를
    // 복제하지 않는다(Postgres 문서상 LIKE 는 FK 를 절대 복사하지 않는다). 이 테스트
    // 스키마에는 그 cascade 가 없으므로 items 를 exports 와 별개로 직접 비워야 한다 —
    // 안 그러면 이전 테스트가 쓴 items 행이 다음 테스트로 새어 들어간다.
    await admin`DELETE FROM product_form_export_items`;
    await admin`DELETE FROM product_form_exports`;
    // a/b 는 beforeAll 에서 한 번만 만들어 커넥션을 재사용한다. `jest.clearAllMocks()`
    // 만으로는 부족하다 — `.mockClear()` 는 호출 이력만 지우고 `mockResolvedValueOnce` 로
    // 예약된 값은 그대로 남긴다(jest 문서: 구현을 지우는 건 `mockReset` 뿐이다). 한 테스트가
    // 예약해둔 once 값을 소비하기 전에 던지면(예: 잘못된 fixture 로 쿼리가 실패하면) 그
    // 값이 다음 테스트로 새어 들어간다 — 실제로 이 파일 초안에서 그 사고가 났다. `mockReset`
    // 으로 once 큐까지 완전히 비운 뒤 기본 구현을 다시 세운다.
    for (const worker of [a, b]) {
      worker.buildPrefill
        .mockReset()
        .mockImplementation(() => Promise.resolve({ data: EMPTY_PREFILL_DATA, items: [] }));
      worker.upload.mockReset().mockImplementation(() => Promise.resolve({ fileId: STUB_FILE_ID }));
    }
  });

  /** claim 이 집을 수 있는 queued 잡 하나. requestedMasterIds 는 빈 배열 — 스냅샷 스텁이 무시한다. */
  async function seedQueuedExport(): Promise<string> {
    const id = randomUUID();
    const requestedBy = randomUUID();
    await admin`
      INSERT INTO product_form_exports (id, requested_by, requested_master_ids, status, expires_at)
      VALUES (${id}, ${requestedBy}, ${'{}'}::uuid[], 'queued', NOW() + interval '30 days')
    `;
    return id;
  }

  async function readExport(exportId: string) {
    const [row] = await admin`
      SELECT status, file_id, product_count, error_message, lease_token, lease_until, consecutive_failures,
             EXTRACT(EPOCH FROM lease_until)::float8 AS lease_epoch,
             (lease_until > NOW()) AS is_live
        FROM product_form_exports
       WHERE id = ${exportId}
    `;
    return row as {
      status: string;
      file_id: string | null;
      product_count: number;
      error_message: string | null;
      lease_token: string | null;
      lease_until: unknown;
      consecutive_failures: number;
      lease_epoch: number | null;
      is_live: boolean | null;
    };
  }

  it('클레임은 토큰을 발급하고 잡을 running 으로 바꾼다', async () => {
    const exportId = await seedQueuedExport();

    const claimed = await a.manager.claim();

    expect(claimed).not.toBeNull();
    expect(claimed!.exportId).toBe(exportId);
    expect(claimed!.leaseToken).toMatch(UUID_V7);

    const row = await readExport(exportId);
    expect(row.status).toBe('running');
    // DB 에 실제로 박힌 토큰이 우리가 들고 있는 값과 같아야 한다 — 이후 CAS 가 전부 이 등식에 걸린다.
    expect(row.lease_token).toBe(claimed!.leaseToken);
    expect(row.is_live).toBe(true);
  });

  it('claim 은 대기 잡이 없으면 null 이다', async () => {
    expect(await a.manager.claim()).toBeNull();
  });

  // ─── 핵심 단정 1/3: 브리프 Step 4 ───
  it('두 번째 claim 은 lease 가 살아있는 동안 같은 잡을 잡지 못한다', async () => {
    const exportId = await seedQueuedExport();

    const first = await a.manager.claim();
    expect(first).not.toBeNull();
    expect(first!.exportId).toBe(exportId);

    // lease 가 살아있다 → 자격 잡이 하나도 없다(이 스키마엔 이 행뿐이다).
    expect(await b.manager.claim()).toBeNull();
    // 우리 행이 건드려지지 않았음도 직접 본다.
    expect((await readExport(exportId)).lease_token).toBe(first!.leaseToken);
  });

  // ─── 핵심 단정 2/3: 브리프 Step 4 ───
  it('lease 가 만료되면 다시 클레임되고 토큰이 바뀐다', async () => {
    const exportId = await seedQueuedExport();
    const first = await a.manager.claim();
    expect(first).not.toBeNull();

    // lease 만료(= 처리하던 프로세스가 죽었다).
    await admin`UPDATE product_form_exports SET lease_until = NOW() - interval '1 minute' WHERE id = ${exportId}`;

    const second = await b.manager.claim();
    expect(second).not.toBeNull();
    expect(second!.exportId).toBe(first!.exportId);
    // 인수한 워커는 **새 토큰**을 발급한다. 같은 토큰이면 펜싱이 성립하지 않는다.
    expect(second!.leaseToken).not.toBe(first!.leaseToken);
    expect((await readExport(exportId)).lease_token).toBe(second!.leaseToken);
  });

  // ─── 핵심 단정 3/3: 브리프 Step 4 (+ Critical 1 / Important 2 재현) ───
  //
  // 이전 버전은 status/lease_token/file_id 만 봤다 — items 스텁이 둘 다 빈 배열이라
  // delete+insert 가 항상 no-op 이었고, 그래서 이 테스트는 items 테이블에 대해 아무 것도
  // 증명하지 못했다(리뷰가 지적한 지점). 좀비와 후임이 **서로 다른** 스냅샷을 봤다고
  // 가정하고(실제로 그럴 수 있다 — 두 조립 사이에 상품이 바뀌면), 좀비가 뒤늦게 깨어나
  // items 를 델리트+인서트해도 후임의 항목이 살아남는지 items 테이블에서 직접 확인한다.
  it('옛 토큰으로는 마감하지 못한다 — 좀비가 후임의 items 를 덮어쓰지 않는다', async () => {
    const exportId = await seedQueuedExport();
    const zombie = await a.manager.claim();
    expect(zombie).not.toBeNull();

    // 좀비의 lease 가 만료되고 후임이 인수한다.
    await admin`UPDATE product_form_exports SET lease_until = NOW() - interval '1 minute' WHERE id = ${exportId}`;
    const successor = await b.manager.claim();
    expect(successor).not.toBeNull();
    expect(successor!.leaseToken).not.toBe(zombie!.leaseToken);

    // 두 워커가 서로 다른 스냅샷을 봤다고 가정한다 — 리뷰 재현 시나리오와 같은 모양:
    // 후임(B)은 두 항목을, 좀비(A)는 겹치지 않는 한 항목만 봤다. masterId/versionId 는
    // 실제 uuid 컬럼이라(product_form_export_items.master_id/version_id) 유효한 uuid
    // 문자열이어야 한다 — 문자열 리터럴('m1' 등)은 실 Postgres 에서 22P02 로 거부된다.
    const successorItems: SnapshotItem[] = [
      {
        masterId: randomUUID(),
        versionId: randomUUID(),
        rowKey: 'P-000001',
        pricingEditable: true,
        snapshot: EMPTY_SNAPSHOT,
      },
      {
        masterId: randomUUID(),
        versionId: randomUUID(),
        rowKey: 'P-000002',
        pricingEditable: true,
        snapshot: EMPTY_SNAPSHOT,
      },
    ];
    const zombieItems: SnapshotItem[] = [
      {
        masterId: randomUUID(),
        versionId: randomUUID(),
        rowKey: 'Z-000001',
        pricingEditable: true,
        snapshot: EMPTY_SNAPSHOT,
      },
    ];
    b.buildPrefill.mockResolvedValueOnce({ data: EMPTY_PREFILL_DATA, items: successorItems });
    b.upload.mockResolvedValueOnce({ fileId: STUB_FILE_ID_B });
    a.buildPrefill.mockResolvedValueOnce({ data: EMPTY_PREFILL_DATA, items: zombieItems });
    a.upload.mockResolvedValueOnce({ fileId: STUB_FILE_ID_A });

    // 후임이 먼저 정상적으로 마감한다 — completed, 항목 2개, product_count=2.
    await expect(b.manager.runExport(successor!)).resolves.toBe(true);
    const afterSuccessor = await readExport(exportId);
    expect(afterSuccessor.status).toBe('completed');
    expect(afterSuccessor.file_id).toBe(STUB_FILE_ID_B);
    expect(afterSuccessor.product_count).toBe(2);

    // 좀비가 뒤늦게 깨어나 마감을 시도한다. runExport 는 pending 유무와 무관하게 스냅샷/
    // 업로드까지는 무조건 실행하지만(위 헤더 코멘트), 마감 CAS 가 0행을 매치하므로
    // false 를 돌려주고 items 델리트/인서트에는 아예 도달하면 안 된다.
    await expect(a.manager.runExport(zombie!)).resolves.toBe(false);

    const after = await readExport(exportId);
    // 마감이 CAS 없이 무조건 쓰였다면 여기서 status/file_id/product_count 가 좀비 값으로
    // 덮인다 — 그 회귀를 진짜 DB 에서 잡는다.
    expect(after.status).toBe('completed');
    expect(after.file_id).toBe(STUB_FILE_ID_B);
    expect(after.product_count).toBe(2);

    // Critical 1 회귀 방지의 핵심 단정: items 테이블 자체를 본다. 예전 구현은 CAS 를
    // 트랜잭션의 **마지막** 문장으로 둬서, CAS 가 0행이어도 그 앞의 델리트+인서트는 이미
    // 커밋된 뒤였다 — 후임의 두 항목이 사라지고 좀비의 항목 하나로 바뀌는데
    // product_count 는 여전히 2 로 남아 서로 어긋나는 데이터 손상이 실 Postgres 에서
    // 재현됐다(리뷰 로그: product_count=2, items 는 1행뿐).
    // postgres.js 의 태그드 템플릿은 행 타입을 좁혀주지 않는다 — readExport() 와 같은
    // 이유로 실제 select 절 모양으로 캐스팅한다.
    const items = (await admin`
      SELECT row_key, master_id FROM product_form_export_items
       WHERE export_id = ${exportId} ORDER BY row_key
    `) as unknown as Array<{ row_key: string; master_id: string }>;
    expect(items.map((r) => r.row_key)).toEqual(['P-000001', 'P-000002']);
    expect(items.some((r) => r.row_key === 'Z-000001')).toBe(false);
  });

  it('요청 masterId 가 없어도(빈 배열) 스냅샷·업로드를 거쳐 completed 로 마감한다', async () => {
    const exportId = await seedQueuedExport();
    const claimed = await a.manager.claim();

    await a.manager.runExport(claimed!);

    const row = await readExport(exportId);
    expect(row.status).toBe('completed');
    expect(row.file_id).toBe(STUB_FILE_ID);
    expect(row.product_count).toBe(0);
    expect(row.lease_until).toBeNull();
    expect(row.lease_token).toBeNull();
    expect(a.buildPrefill).toHaveBeenCalledWith(expect.anything(), [], exportId);
    expect(a.upload).toHaveBeenCalled();
  });

  /**
   * 워커 한 번의 재시도 사이클: 재시도 대기가 지난 상황을 만들고 → 클레임하고 → 조립이
   * 터져 실패를 기록한다. 한 클레임당 실패는 정확히 한 번 기록된다(같은 토큰으로 두 번
   * 기록하려 하면 두 번째는 CAS 가 0행을 매치한다 — 그것도 이중 계상이므로 옳다).
   * 클레임을 못 받으면 `null` 을 돌려주므로 호출부가 "예산이 남았는지" 를 셀 수 있다.
   */
  async function retryCycle(exportId: string, worker: typeof a, message: string): Promise<string | null> {
    await admin`
      UPDATE product_form_exports SET lease_until = NOW() - interval '1 second'
       WHERE id = ${exportId} AND status = 'running'
    `;
    const claimed = await worker.manager.claim();
    if (!claimed) return null;
    await worker.manager.recordJobError(exportId, claimed.leaseToken, message);
    return claimed.exportId;
  }

  it('연속 실패가 상한에 닿으면 failed 로 확정되고 lease 가 풀린다', async () => {
    const exportId = await seedQueuedExport();

    for (let i = 0; i < MAX_CONSECUTIVE_EXPORT_FAILURES; i += 1) {
      expect(await retryCycle(exportId, a, `반복 오류 ${i}`)).toBe(exportId);
    }

    const row = await readExport(exportId);
    expect(Number(row.consecutive_failures)).toBe(MAX_CONSECUTIVE_EXPORT_FAILURES);
    expect(row.status).toBe('failed');
    expect(row.lease_token).toBeNull();
    // failed 잡은 claim 후보가 아니다 — 무한 재시도가 여기서 끝난다.
    expect(await a.manager.claim()).toBeNull();
  });

  // 상한이 3 이면 **실제 조립 시도도 3회**여야 한다. 이 단정이 재시도 예산 그 자체다 —
  // 정상 재시도 경로에서 실패가 두 번 세어지면(recordJobError 가 +1, 뒤이은 claim 이 또
  // +1) 예산이 조용히 2회로 줄어들고, 여기서 세 번째 사이클이 null 을 받아 빨개진다.
  it('정상 재시도 경로에서 조립 시도가 상한 횟수만큼 보장된다', async () => {
    const exportId = await seedQueuedExport();

    let attempts = 0;
    for (let i = 0; i < MAX_CONSECUTIVE_EXPORT_FAILURES; i += 1) {
      if ((await retryCycle(exportId, a, `일시적 오류 ${i}`)) === null) break;
      attempts += 1;
    }

    expect(attempts).toBe(MAX_CONSECUTIVE_EXPORT_FAILURES);
    expect((await readExport(exportId)).status).toBe('failed');
  });

  it('상한 직전까지는 잡을 건드리지 않는다', async () => {
    const exportId = await seedQueuedExport();

    for (let i = 0; i < MAX_CONSECUTIVE_EXPORT_FAILURES - 1; i += 1) {
      expect(await retryCycle(exportId, a, `일시적 오류 ${i}`)).toBe(exportId);
    }

    const row = await readExport(exportId);
    expect(row.status).toBe('running');
    expect(Number(row.consecutive_failures)).toBe(MAX_CONSECUTIVE_EXPORT_FAILURES - 1);
    // 아직 예산이 남았다 — 다음 틱이 다시 집어갈 수 있어야 한다.
    expect(await retryCycle(exportId, a, '마지막 오류')).toBe(exportId);
  });

  // ─── 리뷰 Important: 정상 재시도 경로의 이중 계상 ───
  //
  // recordJobError 가 lease_token 을 남기면, 60초 뒤 claim 이 그 행을 집을 때
  // `lease_token IS NOT NULL` 이라 CASE WHEN 이 **또** +1 한다 — 직전 소유자는 죽은 게
  // 아니라 실패를 정상적으로 기록하고 떠났는데도. 그래서 recordJobError 가 토큰을 비운다:
  // "토큰이 남아 있다 = 소유자가 **기록도 못 하고** 죽었다" 가 정확히 성립한다.
  it('실패를 정상적으로 기록한 뒤 재클레임해도 실패는 한 번만 세어진다', async () => {
    const exportId = await seedQueuedExport();
    const claimed = await a.manager.claim();

    await a.manager.recordJobError(exportId, claimed!.leaseToken, '일시적 오류');
    expect(Number((await readExport(exportId)).consecutive_failures)).toBe(1);

    // 토큰을 비워도 재시도 대기(60초) 안에는 아무도 못 집는다 — 후보 필터의
    // `lease_until IS NULL OR lease_until < NOW()` 가 계속 막는다. 이게 "토큰을 비우면
    // 레이스가 생기지 않나" 에 대한 답이고, 여기서 실측한다.
    expect(await b.manager.claim()).toBeNull();

    // 재시도 대기가 지났다.
    await admin`UPDATE product_form_exports SET lease_until = NOW() - interval '1 second' WHERE id = ${exportId}`;
    const reclaimed = await b.manager.claim();

    expect(reclaimed?.exportId).toBe(exportId);
    // 실패는 여전히 1건이다 — 2 면 이중 계상이다.
    expect(Number((await readExport(exportId)).consecutive_failures)).toBe(1);
  });

  it('정상 종료한 조립의 리셋이 카운터를 0 으로 되돌린다', async () => {
    const exportId = await seedQueuedExport();
    const claimed = await a.manager.claim();
    await a.manager.recordJobError(exportId, claimed!.leaseToken, '일시적 오류');

    await a.manager.clearConsecutiveFailures(exportId);

    expect((await readExport(exportId)).consecutive_failures).toBe(0);
  });

  // ─── `CASE WHEN lease_token IS NULL` 의미론의 **유일한** 검증 ───
  //
  // 이 두 케이스는 단위 스펙으로 옮길 수 없다 — 목 trx.execute 는 SQL 을 실행하지 않고
  // 미리 정한 행을 돌려줄 뿐이라, CASE 절을 통째로 지워도 목 기반 테스트는 초록으로
  // 남는다. 실제 Postgres 가 실제 행에 그 UPDATE 를 적용해야만 잠긴다.
  it('첫 클레임(lease_token NULL)은 실패로 세지 않는다', async () => {
    const exportId = await seedQueuedExport();

    const claimed = await a.manager.claim();

    expect(claimed?.exportId).toBe(exportId);
    expect(Number((await readExport(exportId)).consecutive_failures)).toBe(0);
  });

  it('lease 만료 재클레임은 직전 시도를 실패로 센다', async () => {
    const exportId = await seedQueuedExport();
    // 1회차 클레임이 토큰을 박고 lease 를 미래로 민다.
    await a.manager.claim();
    // 워커가 끝내지 못한 채 lease 만 만료된 상황을 만든다.
    await admin`
      UPDATE product_form_exports SET lease_until = NOW() - interval '1 minute' WHERE id = ${exportId}
    `;

    const reclaimed = await b.manager.claim();

    expect(reclaimed?.exportId).toBe(exportId);
    expect(Number((await readExport(exportId)).consecutive_failures)).toBe(1);
  });

  // 재클레임 카운트가 상한을 채우면 claim 이 **조립을 시작하지 않고** 곧장 failed 로
  // 확정한다 — 워커가 강제 종료돼 catch(=recordJobError)가 아예 실행되지 않는 경우에도
  // 무한 재시도가 여기서 유계가 된다. 현행 구현이 못 세던 경우가 정확히 이것이다.
  it('재클레임 누적이 상한에 닿으면 claim 이 조립 없이 failed 로 확정한다', async () => {
    const exportId = await seedQueuedExport();

    // 매번 lease 를 만료시켜 "워커가 lease 안에 못 끝내고 죽었다" 를 상한 횟수만큼 만든다.
    for (let i = 0; i < MAX_CONSECUTIVE_EXPORT_FAILURES; i += 1) {
      await a.manager.claim();
      await admin`UPDATE product_form_exports SET lease_until = NOW() - interval '1 minute' WHERE id = ${exportId}`;
    }

    // 상한을 채운 상태의 재클레임 — 잡을 돌려주지 않고 확정만 한다.
    expect(await b.manager.claim()).toBeNull();

    const row = await readExport(exportId);
    expect(row.status).toBe('failed');
    expect(row.lease_token).toBeNull();
    expect(row.lease_until).toBeNull();
    // 조립은 시작조차 하지 않았다 — 스냅샷/업로드 협력자가 불리면 안 된다.
    expect(b.buildPrefill).not.toHaveBeenCalled();
    expect(b.upload).not.toHaveBeenCalled();
  });

  // 짧아진 재시도 대기가 실제로 lease 컬럼에 반영되는지 — 90분이 아니라 분 단위여야 한다.
  it('실패 기록이 재시도 대기를 lease(30분)가 아니라 분 단위로 되돌린다', async () => {
    const exportId = await seedQueuedExport();
    const claimed = await a.manager.claim();
    const afterClaim = await readExport(exportId);

    await a.manager.recordJobError(exportId, claimed!.leaseToken, '일시적 오류');

    const afterError = await readExport(exportId);
    // 클레임이 민 lease 보다 **앞당겨져야** 한다(이 스위트의 LEASE_MS 는 30초).
    expect(afterError.lease_epoch!).toBeLessThan(afterClaim.lease_epoch! + FORM_EXPORT_RETRY_DELAY_MS / 1000);
    // 그러면서도 미래여야 한다 — 과거로 밀면 다음 틱이 곧장 집어가 재시도가 사실상 없어진다.
    expect(afterError.is_live).toBe(true);
  });

  // 좀비의 뒤늦은 예외가 **후임의 살아있는 lease 를 깎지 못한다**. CAS 가 없으면 여기서
  // 후임의 lease_until 이 60초 뒤로 당겨져 제3의 워커가 인수하고, 이중 조립·이중 업로드로
  // 진 쪽 xlsx 가 file-service 에 영구 고아로 남는다.
  it('좀비의 실패 기록은 후임의 lease 를 건드리지 못한다', async () => {
    const exportId = await seedQueuedExport();
    const zombie = await a.manager.claim();
    await admin`UPDATE product_form_exports SET lease_until = NOW() - interval '1 minute' WHERE id = ${exportId}`;
    const successor = await b.manager.claim();
    expect(successor!.leaseToken).not.toBe(zombie!.leaseToken);
    const beforeZombie = await readExport(exportId);

    await a.manager.recordJobError(exportId, zombie!.leaseToken, '뒤늦게 도착한 예외');

    const after = await readExport(exportId);
    expect(after.lease_token).toBe(successor!.leaseToken);
    expect(after.lease_epoch).toBe(beforeZombie.lease_epoch);
    expect(after.error_message).toBeNull();
    // 재클레임이 이미 1 을 세어뒀다 — 좀비의 예외가 그 위에 또 얹히면 이중 계상이다.
    expect(Number(after.consecutive_failures)).toBe(1);
  });
});
