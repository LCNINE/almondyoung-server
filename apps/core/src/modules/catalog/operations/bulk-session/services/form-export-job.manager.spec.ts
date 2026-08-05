import { Logger } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  DEFAULT_EXPORT_LEASE_MS,
  FORM_EXPORT_RETRY_DELAY_MS,
  FormExportJobManager,
  MAX_CONSECUTIVE_EXPORT_FAILURES,
} from './form-export-job.manager';
import { productFormExports, productFormExportItems } from '../../../schema/catalog.schema';
import type { PrefillBundle, PrefillWorkbookData } from './form-export.types';
import type { SnapshotItem } from './form-export.snapshot.reader';

/**
 * 이 스위트는 항목의 스냅샷 **값**을 검증하지 않는다(그건 form-export-snapshot.integration.spec.ts
 * 몫이다) — 여기서는 runExport 의 클레임/마감/델리트-인서트 순서만 본다. `SnapshotItem.snapshot`
 * 이 필수 필드라 리터럴을 타입에 맞추기 위한 최소 스텁.
 */
const EMPTY_SNAPSHOT: PrefillBundle = {
  product: {},
  options: [],
  variants: [],
  categories: [],
  constraint: null,
  images: {},
};

/**
 * drizzle sql 조각을 실제 SQL 문자열로 렌더한다. 클레임의 원자성은 바인딩 값이 아니라
 * **쿼리 모양**에 있으므로(SKIP LOCKED, LIMIT 1, running 후보 포함) 이렇게만 단정할 수 있다.
 * product-import-job.manager.spec.ts 와 같은 기법이다.
 */
function renderSql(query: unknown): string {
  return new PgDialect().sqlToQuery(query as never).sql;
}

/**
 * SQL 과 함께 바인딩된 파라미터 값도 돌려준다. CAS 비교가 "아무 값"이 아니라
 * **정확히 기대한 값**과 비교하는지는 조건절 문자열만으로는 단정할 수 없다
 * (플레이스홀더 `$n` 만 보이므로) — params 를 봐야 한다.
 */
function renderQuery(query: unknown): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(query as never);
}

type FakeRow = Record<string, unknown>;

/**
 * drizzle 셀렉트 빌더는 thenable 이면서 `.limit()` 도 체이닝된다 — form-export.manager.spec.ts
 * 의 chain() 과 같은 기법이다(any 없이 명시 타입으로 만든다).
 */
interface ChainResult extends Promise<FakeRow[]> {
  limit(): Promise<FakeRow[]>;
}

function chain(rows: FakeRow[]): ChainResult {
  // Promise 인스턴스에 `.limit` 을 얹어 thenable+체이너블 양쪽을 만족시킨다 — 이 형태
  // 자체가 실제 drizzle 빌더 타입과 구조적으로 다르므로 캐스팅이 불가피하다.
  const builder = Promise.resolve(rows) as ChainResult;
  builder.limit = () => Promise.resolve(rows);
  return builder;
}

/** update().set().where() 체인의 반환값 — recordJobError 가 `.returning()` 을 추가로 체이닝한다. */
interface UpdateChain extends Promise<void> {
  returning(): Promise<FakeRow[]>;
}

/** FormExportJobManager 가 실제로 호출하는 trx 메서드만 흉내낸 최소 모양. */
interface FakeTrx {
  execute: jest.Mock<Promise<FakeRow[]>, unknown[]>;
  select: () => { from: (table: unknown) => { where: () => ChainResult } };
  delete: (table: unknown) => { where: (condition?: unknown) => Promise<void> };
  insert: (table: unknown) => { values: (values: unknown) => Promise<void> };
  update: (table: unknown) => {
    set: (values: FakeRow) => { where: (condition?: unknown) => UpdateChain };
  };
}

interface FakeDb {
  run: <T>(fn: (trx: FakeTrx) => Promise<T>) => Promise<T>;
}

const EMPTY_PREFILL_DATA: PrefillWorkbookData = {
  exportId: 'exp-1',
  products: [],
  options: [],
  variants: [],
  categories: [],
  constraints: [],
  images: [],
  categoryPaths: [],
};

const JOB_ROW = {
  id: 'exp-1',
  requestedBy: 'user-1',
  requestedMasterIds: ['m1', 'm2'],
  status: 'running',
  fileId: null,
  productCount: 0,
  errorMessage: null,
  leaseUntil: new Date(),
  leaseToken: 'tok-1',
  consecutiveFailures: 0,
  expiresAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

interface HarnessOpts {
  claimed?: FakeRow[];
  jobRow?: FakeRow | null;
  returningRows?: Array<FakeRow[]>;
  /**
   * runExport 의 마감 CAS(`status: 'completed'` update)가 소유권을 유지한 채 실행됐는지.
   * `false` 면 0행(레이스에서 짐 — 후임이 인수했거나 상한에 닿아 failed 로 확정됨)을
   * 흉내낸다. 기본값 `true` — 대부분의 테스트는 소유권을 유지한 정상 경로를 본다.
   */
  finalizeOwned?: boolean;
  snapshotResult?: { data: PrefillWorkbookData; items: SnapshotItem[] };
  uploadResult?: { fileId: string };
}

/**
 * FormExportJobManager 가 실제로 부르는 trx 메서드(execute/select/delete/insert/update)
 * 만 흉내낸 하네스. product-import-job.manager.spec.ts 의 makeHarness() 와 같은 모양이다 —
 * 이 클래스의 claim 이 그 파일의 claim 을 컬럼만 바꿔 가져온 것이므로, 검증 기법도 그대로
 * 가져온다. form-export.manager.spec.ts 와 같은 이유로 `any` 대신 명시 타입을 쓴다.
 */
function makeHarness(opts: HarnessOpts = {}) {
  const updates: Array<{ table: string; values: FakeRow; condition?: unknown }> = [];
  const deletes: Array<{ table: string; condition?: unknown }> = [];
  const inserts: Array<{ table: string; values: unknown }> = [];
  let returningCallIndex = 0;
  const jobRow = opts.jobRow === undefined ? JOB_ROW : opts.jobRow;

  const trx: FakeTrx = {
    execute: jest.fn(() => Promise.resolve(opts.claimed ?? [])),
    // 이 매니저는 select().from()을 productFormExports 한 곳에만 쓴다(runExport 의 잡
    // 조회) — product-import-job.manager.spec.ts 와 달리 테이블별로 가를 필요가 없다.
    select: () => ({
      from: () => ({
        where: () => chain(jobRow ? [jobRow] : []),
      }),
    }),
    delete: (table) => ({
      where: (condition) => {
        deletes.push({ table: table === productFormExportItems ? 'items' : 'exports', condition });
        return Promise.resolve();
      },
    }),
    insert: (table) => ({
      values: (values) => {
        inserts.push({ table: table === productFormExportItems ? 'items' : 'exports', values });
        return Promise.resolve();
      },
    }),
    update: (table) => ({
      set: (values) => ({
        where: (condition): UpdateChain => {
          updates.push({ table: table === productFormExports ? 'exports' : 'items', values, condition });
          const result = Promise.resolve() as UpdateChain;
          // recordJobError/runExport 마감 둘 다 .returning() 을 체이닝한다 — set 값 모양으로
          // 갈라 각자의 시나리오를 흉내낸다.
          result.returning = () => {
            if (values.status === 'completed') {
              // runExport 의 마감 CAS. finalizeOwned:false 면 0행(레이스에서 짐)을 낸다 —
              // Critical 1 수정이 여기서 멈추고 items 델리트/인서트에 도달하지 않는지가
              // 핵심 단정이다.
              return Promise.resolve(opts.finalizeOwned === false ? [] : [{ id: 'exp-1' }]);
            }
            // recordJobError. opts.returningRows 를 안 주면 연속 실패 미상(→ 1건, 상한
            // 미만 취급)으로 떨어진다.
            const rows = opts.returningRows
              ? opts.returningRows[Math.min(returningCallIndex, opts.returningRows.length - 1)]
              : [{ failures: 1 }];
            returningCallIndex += 1;
            return Promise.resolve(rows);
          };
          return result;
        },
      }),
    }),
  };
  const db: FakeDb = { run: (fn) => fn(trx) };
  // execute 와 같은 이유로 unknown[] 인자 타입을 명시한다 — 구현은 인자를 안 받지만(테스트가
  // 신경 쓰는 건 반환값뿐이다), 호출부(runExport)가 넘기는 실제 인자는 .mock.calls 로
  // 검사해야 하므로 튜플을 비워두면 `.calls[0][n]` 접근에서 타입 에러가 난다.
  const buildPrefill: jest.Mock<Promise<{ data: PrefillWorkbookData; items: SnapshotItem[] }>, unknown[]> = jest.fn(
    () => Promise.resolve(opts.snapshotResult ?? { data: EMPTY_PREFILL_DATA, items: [] }),
  );
  const upload: jest.Mock<Promise<{ fileId: string }>, unknown[]> = jest.fn(() =>
    Promise.resolve(opts.uploadResult ?? { fileId: 'file-1' }),
  );
  const config = { get: () => undefined };

  // Manager 생성자는 실제 DbService<PimSchema>/FormExportSnapshotReader/FormExportFileClient/
  // ConfigService 타입을 요구한다 — 이 페이크들은 Manager 가 실제로 부르는 메서드(run/
  // buildPrefill/upload/get)만 구조적으로 흉내내므로 완전한 구조 일치가 아니다.
  // form-export.manager.spec.ts / product-import.manager.spec.ts harness 와 같은 관례로
  // `as never` 캐스팅한다.
  const manager = new FormExportJobManager(
    db as never,
    { buildPrefill } as never,
    { upload } as never,
    config as never,
  );
  return { manager, updates, deletes, inserts, trx, buildPrefill, upload };
}

describe('FormExportJobManager.claim', () => {
  it('SKIP LOCKED 로 한 잡만 잡고, lease 만료된 running 도 다시 잡는다', async () => {
    const { manager, trx } = makeHarness({ claimed: [{ id: 'exp-1' }] });

    const claimed = await manager.claim();

    expect(claimed?.exportId).toBe('exp-1');
    const sql = renderSql(trx.execute.mock.calls[0][0]).toLowerCase();
    expect(sql).toContain('for update skip locked');
    expect(sql).toContain('limit 1');
    // 재개 경로: running 을 후보에서 빼면 죽은 워커의 잡이 영영 멈춘다.
    expect(sql).toContain("'running'");
    expect(sql).toContain('lease_until');
    expect(sql).toContain('lease_token');
    // ::uuid 캐스트가 빠지면 PG 가 text 바인딩과 uuid 컬럼을 맞추지 못해 실패한다.
    expect(sql).toContain('::uuid');
    // 만료시각은 DB 시계가 만든다 — 비교 대상이 아니므로 정밀도가 무관하다.
    expect(sql).toContain('now()');

    const { params } = renderQuery(trx.execute.mock.calls[0][0]);
    // 소유권 값은 DB 가 만들지 않는다 — 클레임이 uuid 토큰을 발급해 바인딩한다.
    // Date 를 raw sql 에 바인딩하면 드라이버가 죽던 회귀가 여기서 잡힌다.
    expect(params.some((p) => p instanceof Date)).toBe(false);
    expect(claimed!.leaseToken).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(params).toContain(claimed!.leaseToken);
  });

  it('클레임마다 새 토큰을 발급한다 — 두 워커가 같은 토큰을 들면 CAS 가 무력해진다', async () => {
    const { manager } = makeHarness({ claimed: [{ id: 'exp-1' }] });

    const first = await manager.claim();
    const second = await manager.claim();

    expect(first!.leaseToken).not.toBe(second!.leaseToken);
  });

  it('클레임할 잡이 없으면 null 이다', async () => {
    const { manager } = makeHarness({ claimed: [] });
    expect(await manager.claim()).toBeNull();
  });
});

/**
 * recordJobError 의 토큰 CAS 가 뚫는 구멍(좀비의 실패가 안 세어져 상한에 영원히 못 닿음)을
 * claim 이 막는다 — 재클레임 시점에 lease_token 이 남아 있으면 직전 소유자가 못 끝내고
 * 죽었다는 뜻이므로 거기서 +1 한다.
 *
 * `CASE WHEN lease_token IS NULL` 이라는 **SQL 의미론 자체**는 여기서 잠글 수 없다 — 목
 * trx.execute 는 SQL 을 실행하지 않고 미리 정한 행을 돌려줄 뿐이다. 여기서는 그 카운트를
 * 받아든 뒤의 **분기**(상한 미만이면 조립, 상한이면 즉시 확정)만 본다. CASE 의미론은
 * form-export-job-lease.integration.spec.ts 의 실 DB 케이스 2건이 잠근다.
 */
describe('claim 이 재클레임을 실패로 센다', () => {
  it('상한 미만이면 잡을 돌려준다', async () => {
    const { manager } = makeHarness({ claimed: [{ id: 'exp-1', consecutive_failures: 1 }] });

    const claimed = await manager.claim();

    expect(claimed?.exportId).toBe('exp-1');
  });

  it('재클레임 누적이 상한이면 조립하지 않고 failed 로 확정한 뒤 null 을 돌려준다', async () => {
    const { manager, updates } = makeHarness({
      claimed: [{ id: 'exp-1', consecutive_failures: MAX_CONSECUTIVE_EXPORT_FAILURES }],
    });

    const claimed = await manager.claim();

    expect(claimed).toBeNull();
    expect(updates).toHaveLength(1);
    expect(updates[0].values).toEqual({ status: 'failed', leaseUntil: null, leaseToken: null });
  });
});

describe('FormExportJobManager.runExport', () => {
  const CLAIMED = { exportId: 'exp-1', leaseToken: 'tok-1' };

  it('잡을 찾지 못하면 아무 것도 하지 않고 false 를 돌려준다', async () => {
    const { manager, buildPrefill, upload, updates } = makeHarness({ jobRow: null });

    await expect(manager.runExport(CLAIMED)).resolves.toBe(false);

    expect(buildPrefill).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('요청 masterId 로 스냅샷을 만들어 업로드하고 completed 로 마감하며 true 를 돌려준다', async () => {
    const items: SnapshotItem[] = [
      { masterId: 'm1', versionId: 'v1', rowKey: 'P-000001', pricingEditable: true, snapshot: EMPTY_SNAPSHOT },
    ];
    const { manager, buildPrefill, upload, updates } = makeHarness({
      snapshotResult: { data: EMPTY_PREFILL_DATA, items },
      uploadResult: { fileId: 'file-9' },
    });

    await expect(manager.runExport(CLAIMED)).resolves.toBe(true);

    expect(buildPrefill).toHaveBeenCalledWith(expect.anything(), JOB_ROW.requestedMasterIds, 'exp-1');
    expect(upload).toHaveBeenCalledTimes(1);
    // upload 는 jest.Mock<..., unknown[]> 로 선언돼 있다 — 실제 upload 입력 모양으로 좁혀야
    // fileName/userId 를 안전하게 읽을 수 있다(expect.stringMatching 을 object literal 안에
    // 섞으면 그 매처의 `any` 반환 타입이 no-unsafe-assignment 를 낸다 — 그래서 따로 뗀다).
    const [uploadArg] = upload.mock.calls[0] as [{ buffer: Buffer; fileName: string; userId: string }];
    expect(uploadArg.userId).toBe(JOB_ROW.requestedBy);
    expect(uploadArg.fileName).toMatch(/\.xlsx$/);
    const finalize = updates.find((u) => u.table === 'exports');
    expect(finalize!.values).toMatchObject({
      status: 'completed',
      fileId: 'file-9',
      productCount: 1,
      errorMessage: null,
      leaseUntil: null,
      leaseToken: null,
    });
  });

  it('마감은 토큰 CAS 를 건다 — id 매치만으로는 안 된다', async () => {
    const { manager, updates } = makeHarness();

    await manager.runExport(CLAIMED);

    const finalize = updates.find((u) => u.table === 'exports');
    const { sql, params } = renderQuery(finalize!.condition);
    expect(sql.toLowerCase()).toMatch(/"lease_token"\s*=/);
    expect(params).toHaveLength(2); // id + 클레임 토큰
    expect(params).toContain('tok-1');
  });

  it('재조립이면 옛 항목을 먼저 지운 뒤에 새로 넣는다 — UNIQUE 충돌을 피한다', async () => {
    const items: SnapshotItem[] = [
      { masterId: 'm1', versionId: 'v1', rowKey: 'P-000001', pricingEditable: true, snapshot: EMPTY_SNAPSHOT },
    ];
    const { manager, deletes, inserts } = makeHarness({ snapshotResult: { data: EMPTY_PREFILL_DATA, items } });

    await manager.runExport(CLAIMED);

    expect(deletes).toHaveLength(1);
    expect(deletes[0].table).toBe('items');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe('items');
    expect(inserts[0].values).toEqual([{ exportId: 'exp-1', ...items[0] }]);
  });

  it('스냅샷 항목이 없으면 insert 를 부르지 않는다 — 빈 배열 insert 는 무의미하다', async () => {
    const { manager, deletes, inserts } = makeHarness({ snapshotResult: { data: EMPTY_PREFILL_DATA, items: [] } });

    await manager.runExport(CLAIMED);

    expect(deletes).toHaveLength(1);
    expect(inserts).toHaveLength(0);
  });

  // ─── Critical 1 회귀 방지 ───
  // 마감 CAS 가 0행을 매치하면(lease 를 이미 잃음) items 델리트/인서트에 아예 도달하면
  // 안 된다 — 예전 구현은 CAS 를 트랜잭션의 **마지막** 문장으로 둬서, CAS 가 0행이어도
  // 그 앞의 items 델리트/인서트는 이미 커밋된 뒤였다. 그 결과 좀비가 후임의
  // product_form_export_items 를 자기 것으로 덮어쓰는 데이터 손상이 실 Postgres 에서
  // 재현됐다(리뷰 재현 로그: product_count=2 인데 items 는 1행만 남음).
  it('CAS 가 0행을 매치하면(레이스에서 짐) items 를 전혀 건드리지 않고 false 를 돌려준다', async () => {
    const items: SnapshotItem[] = [
      { masterId: 'm1', versionId: 'v1', rowKey: 'P-000001', pricingEditable: true, snapshot: EMPTY_SNAPSHOT },
    ];
    const { manager, deletes, inserts } = makeHarness({
      snapshotResult: { data: EMPTY_PREFILL_DATA, items },
      finalizeOwned: false,
    });

    await expect(manager.runExport(CLAIMED)).resolves.toBe(false);

    // CAS 시도 자체(UPDATE 문)는 실행됐지만(0행 매치), 그 뒤의 델리트/인서트에는
    // 도달하지 않아야 한다 — 이게 순서를 뒤집은 이유다.
    expect(deletes).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  it('CAS 가 0행을 매치하면 경고를 로그한다 — 운영자가 이중 조립 신호를 받아야 한다', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const { manager } = makeHarness({ finalizeOwned: false });

      await manager.runExport(CLAIMED);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('exp-1'));
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('FormExportJobManager.recordJobError', () => {
  it('상한 미만이면 상태를 바꾸지 않는다 — 일시적 오류로 잡을 죽이지 않는다', async () => {
    const { manager, updates } = makeHarness({ returningRows: [[{ failures: 1 }]] });

    await manager.recordJobError('e1', 'TOKEN-1', '일시적 DB 오류');

    expect(updates.some((u) => u.values.status === 'failed')).toBe(false);
    const update = updates[0];
    expect(update.values).toMatchObject({ errorMessage: '일시적 DB 오류' });
    // 토큰은 건드리지 않는다 — 다음 시도는 claim 이 **새 토큰**을 발급해 인수한다.
    // 여기서 토큰을 지우면 CAS 의 기준점이 사라져 좀비 판별이 무너진다.
    expect(update.values).not.toHaveProperty('leaseToken');
  });

  // 이 태스크의 핵심. lease_until 한 컬럼이 겸하던 두 축("조립 중 점유 보호" / "재시도
  // 대기") 중 재시도 쪽만 짧게 되돌린다. 예전 구현은 이 값을 **아예 안 건드려** 재시도
  // 주기가 lease 만료(30분)였고 3회 결론까지 약 90분이 걸렸다.
  it('토큰이 일치하면 실패를 기록하고 재시도 대기를 짧게 되돌린다', async () => {
    const { manager, updates } = makeHarness({ returningRows: [[{ failures: 1 }]] });

    await manager.recordJobError('exp-1', 'TOKEN-1', 'boom');

    expect(updates).toHaveLength(1);
    expect(updates[0].values.errorMessage).toBe('boom');
    // lease 를 짧게 되돌리는 것이 이 변경의 핵심이다 — 예전엔 이 값을 아예 안 건드렸다.
    expect(updates[0].values.leaseUntil).toBeDefined();
    // `toBeDefined()` 만으로는 "짧게" 를 잠그지 못한다 — lease(30분)를 그대로 다시 밀어도
    // 통과한다. 되돌리는 값이 재시도 대기 상수인지 바인딩된 파라미터로 확인한다.
    const { params } = renderQuery(updates[0].values.leaseUntil);
    expect(params).toContain(FORM_EXPORT_RETRY_DELAY_MS);
    expect(params).not.toContain(DEFAULT_EXPORT_LEASE_MS);
  });

  // 짧은 재시도의 **전제조건**이 토큰 CAS 다. 이 단정이 없으면 아래 '좀비' 케이스가 CAS 를
  // 전혀 잠그지 못한다 — 목 trx 는 WHERE 를 실행하지 않고 미리 정한 행을 돌려줄 뿐이라,
  // WHERE 에서 토큰 조건을 통째로 지워도 그 케이스는 초록으로 남는다. 그래서 조건절 자체를
  // 렌더해 본다(runExport 의 '마감은 토큰 CAS 를 건다' 와 같은 기법).
  it('WHERE 가 lease 토큰 CAS 를 건다 — 좀비가 후임의 살아있는 lease 를 깎으면 안 된다', async () => {
    const { manager, updates } = makeHarness({ returningRows: [[{ failures: 1 }]] });

    await manager.recordJobError('exp-1', 'TOKEN-1', 'boom');

    const { sql, params } = renderQuery(updates[0].condition);
    expect(sql.toLowerCase()).toMatch(/"lease_token"\s*=/);
    expect(params).toContain('TOKEN-1');
  });

  it('토큰이 다르면(좀비) 두 번째 UPDATE 로 넘어가지 않는다', async () => {
    const { manager, updates } = makeHarness({ returningRows: [[]] });

    await manager.recordJobError('exp-1', 'STALE-TOKEN', 'boom');

    // CAS 0행 매치 → failed 확정 UPDATE 가 없어야 한다
    expect(updates).toHaveLength(1);
  });

  it('상한에 닿으면 failed 로 확정하고 lease 를 푼다', async () => {
    const { manager, updates } = makeHarness({
      returningRows: [[{ failures: MAX_CONSECUTIVE_EXPORT_FAILURES }]],
    });

    await manager.recordJobError('exp-1', 'TOKEN-1', 'boom');

    expect(updates).toHaveLength(2);
    expect(updates[1].values).toEqual({ status: 'failed', leaseUntil: null, leaseToken: null });
  });

  // Critical(리뷰): WHERE 가 id 만으로 매치하면, lease 를 잃은 좀비의 뒤늦은 예외가 후임이
  // 이미 completed 로 끝낸 잡을 다시 건드려 연속 3회면 failed 로 되돌릴 수 있다 — 실제
  // xlsx 는 멀쩡한데 getDownloadUrl 이 영구히 409 를 돌려주게 된다. 토큰 CAS 만으로도
  // 대부분 막히지만 대가가 커서 가드를 이중으로 둔다 — WHERE 절 자체가 종결 상태
  // (completed/failed)를 제외하는지를 SQL 모양으로 단정한다.
  it('WHERE 절이 종결 상태(completed/failed)를 제외한다 — 이미 끝난 잡은 다시 건드리지 않는다', async () => {
    const { manager, updates } = makeHarness({ returningRows: [[{ failures: 1 }]] });

    await manager.recordJobError('e1', 'TOKEN-1', '일시적 DB 오류');

    const { sql } = renderQuery(updates[0].condition);
    expect(sql.toLowerCase()).toContain('"status" not in');
  });

  // 위 가드가 실제로 Postgres 에서 0행을 매치하는 상황(=이미 종결 상태)을 흉내낸다 — 좀비의
  // recordJobError 호출이 이미 completed 인 잡에 도착하면, 첫 번째 update 가 0행을 반환해야
  // 하고, 그러면 상한 판정도 failed 확정 update 도 절대 일어나면 안 된다.
  it('가드가 0 행을 매치하면(이미 종결 상태) failed 확정 update 를 시도하지 않는다', async () => {
    const { manager, updates } = makeHarness({ returningRows: [[]] });

    await manager.recordJobError('e1', 'TOKEN-1', '좀비의 뒤늦은 예외');

    expect(updates).toHaveLength(1);
    expect(updates.some((u) => u.values.status === 'failed')).toBe(false);
  });
});

describe('FormExportJobManager.clearConsecutiveFailures', () => {
  it('연속 실패 카운터를 0 으로 되돌린다', async () => {
    const { manager, updates } = makeHarness();

    await manager.clearConsecutiveFailures('e1');

    expect(updates).toHaveLength(1);
    expect(updates[0].values).toEqual({ consecutiveFailures: 0 });
  });

  // Minor 5 회귀 방지: product-import-job.manager.ts:730-737 과 같은 `> 0` 가드가 있어야
  // 흔한 경우(이미 0)에 불필요한 write 를 만들지 않는다. 브리프 초안에서 이 가드가
  // 빠졌던 적이 있다.
  it('가드로 consecutive_failures > 0 조건을 건다 — 이미 0 이면 write 가 무의미하다', async () => {
    const { manager, updates } = makeHarness();

    await manager.clearConsecutiveFailures('e1');

    const { sql } = renderQuery(updates[0].condition);
    expect(sql.toLowerCase()).toContain('"consecutive_failures" >');
  });
});
