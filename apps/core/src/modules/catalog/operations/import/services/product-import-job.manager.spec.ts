jest.mock(
  '@packages/event-contracts',
  () => ({ PRODUCT_STREAM: { topic: { topic: 'products.events.v1' }, aggregateType: 'Product' } }),
  { virtual: true },
);

import { PgDialect } from 'drizzle-orm/pg-core';
import { ProductImportJobManager, ClaimedSession, MAX_CONSECUTIVE_JOB_FAILURES } from './product-import-job.manager';
import { productImportSessions, productImportItems, productImportImages } from '../../../schema/catalog.schema';

/**
 * drizzle sql 조각을 실제 SQL 문자열로 렌더한다. 클레임의 원자성은 바인딩 값이 아니라
 * **쿼리 모양**에 있으므로(SKIP LOCKED, LIMIT 1, running 후보 포함) 이렇게만 단정할 수 있다.
 * 2단계 supersede 테스트가 쓴 것과 같은 기법이다.
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

/**
 * drizzle 셀렉트 빌더는 thenable 이면서 체이닝도 된다. 코드가 쓰는 세 형태를
 * (`await where(...)`, `where(...).limit(n)`, `where(...).orderBy(c).limit(n)`)
 * 하나로 받는다.
 */
function chain(rows: any[]): any {
  const builder: any = Promise.resolve(rows);
  builder.limit = () => Promise.resolve(rows);
  builder.orderBy = () => ({ limit: () => Promise.resolve(rows) });
  return builder;
}

function makeHarness(
  opts: {
    pendingItems?: any[];
    claimed?: any[];
    returningRows?: any[][];
    imageRows?: Record<'pending' | 'probed', any[]>;
  } = {},
) {
  const updates: any[] = [];
  const pending = opts.pendingItems ?? [];
  let returningCallIndex = 0;
  let imageSelectCallIndex = 0;

  const trx = {
    // execute 는 실제로 sql 인자 하나를 받는다 — 시그니처를 무인자로 두면
    // `mock.calls[0][0]` 접근이 빈 튜플 인덱싱으로 타입 에러가 난다.
    execute: jest.fn(async (_query?: unknown) => opts.claimed ?? []),
    select: (_projection?: any) => ({
      from: (table: any) => ({
        where: (condition?: unknown) => {
          if (table === productImportImages) {
            // status 별로 갈라 돌려준다. 조건절을 파싱하는 대신 호출 순서로 가른다 —
            // runImageSlice 는 항상 pending 을 먼저, 그 다음 probed 를 조회한다.
            const rows = imageSelectCallIndex === 0 ? (opts.imageRows?.pending ?? []) : (opts.imageRows?.probed ?? []);
            imageSelectCallIndex += 1;
            return chain(rows);
          }
          return chain(table === productImportItems ? pending : [{ id: 'sess-1', uploadedBy: 'u1' }]);
        },
      }),
    }),
    update: (table: any) => ({
      set: (values: any) => ({
        // condition 도 남겨둔다 — release/renew 가 CAS 로 소유권을 확인하는지는
        // where 절 자체를 렌더링해야 단정할 수 있다(값만 보면 SET 절과 구분이 안 된다).
        where: (condition?: unknown) => {
          updates.push({
            table: table === productImportSessions ? 'sessions' : table === productImportImages ? 'images' : 'items',
            values,
            condition,
          });
          const result: any = Promise.resolve();
          // renewLease 와 recordJobError 가 .returning() 을 체이닝한다. opts.returningRows 를
          // 안 주면 renewLease 는 성공(비어있지 않은 행)·취소 없음으로, recordJobError 는
          // consecutiveFailures 미상(→ 0 취급)으로 떨어진다.
          result.returning = (_projection?: unknown) => {
            const rows = opts.returningRows
              ? opts.returningRows[Math.min(returningCallIndex, opts.returningRows.length - 1)]
              : [{ id: 'sess-1', cancelRequestedAt: null }];
            returningCallIndex += 1;
            return Promise.resolve(rows);
          };
          return result;
        },
      }),
    }),
  };
  const db = { run: (fn: any, t?: any) => (t ? fn(t) : fn(trx)), db: trx } as any;
  const importManager = { createFromRecord: jest.fn(async () => 'master-1') } as any;
  const variantCodeChecker = { check: jest.fn(async () => undefined) } as any;
  const config = { get: jest.fn(() => undefined) } as any;
  // getSessionImages 는 runCommitSlice 가 슬라이스당 한 번 부른다 — 이 파일의 기존
  // 테스트들은 이미지 키를 참조하는 행이 없으므로 빈 배열로 충분하다(indexSessionImages([])
  // 가 빈 맵 두 개를 만들어 unresolvedImageError 가 항상 null 을 돌려준다).
  const reader = {
    getDraftVersionId: jest.fn(async () => 'draft-1'),
    getSessionImages: jest.fn(async () => []),
  } as any;
  const versionsService = { publishVersion: jest.fn(async () => undefined) } as any;
  // 이 파일의 기존(commit/publish) 테스트들은 이미지 협력자를 쓰지 않는다 — 컴파일을
  // 통과시키기 위한 최소 스텁이다. 이미지 레인 자체를 검증하는 테스트는 harness.db 로
  // 별도 조립되는 imageManager() 를 쓴다(아래).
  const imageFetcher = { probe: jest.fn(), fetch: jest.fn() } as any;
  const fileClient = { upload: jest.fn(), softDelete: jest.fn() } as any;
  const manager = new ProductImportJobManager(
    db,
    importManager,
    variantCodeChecker,
    config,
    reader,
    versionsService,
    imageFetcher,
    fileClient,
  );
  return { manager, updates, trx, db, importManager, variantCodeChecker, reader, versionsService };
}

const PENDING = (rowNumber: number) => ({
  id: `item-${rowNumber}`,
  rowNumber,
  productKey: `P${rowNumber}`,
  status: 'pending',
  payload: {
    rowNumber,
    productKey: `P${rowNumber}`,
    raw: {},
    version: {},
    basePrice: 1000,
    categoryIds: [],
    categoryNames: [],
    options: [],
    variantOverrides: [],
    errors: [],
  },
});

/** 테스트 대다수가 쓰는 기본 클레임 결과. leaseToken 이 모든 CAS 의 비교값이다. */
const CLAIM_TOKEN = '0197f7a0-0000-7000-8000-0000000000aa';
const CLAIM = (sessionId = 'sess-1'): ClaimedSession => ({ sessionId, leaseToken: CLAIM_TOKEN });

/** updates 배열에서 sessions 테이블에 대한 leaseUntil "갱신"(null 도, 미포함도 아닌) 행만 뽑는다. */
function renewalUpdates(updates: any[]): any[] {
  return updates.filter(
    (u) => u.table === 'sessions' && u.values.leaseUntil !== undefined && u.values.leaseUntil !== null,
  );
}

describe('ProductImportJobManager', () => {
  it('클레임은 SKIP LOCKED 로 한 세션만 잡고, lease 만료된 running 도 다시 잡는다', async () => {
    const { manager, trx } = makeHarness({ claimed: [{ id: 'sess-1' }] });

    const claimed = await manager.claimCommit();

    expect(claimed?.sessionId).toBe('sess-1');
    const sql = renderSql(trx.execute.mock.calls[0][0]).toLowerCase();
    expect(sql).toContain('for update skip locked');
    expect(sql).toContain('limit 1');
    // 재개 경로: running 을 후보에서 빼면 크래시한 세션이 영영 멈춘다.
    expect(sql).toContain("'running'");
    expect(sql).toContain('lease_until');

    // Critical 회귀 방지(라운드 4): 소유권 값은 **DB 가 만들지 않는다**. 클레임이 uuid
    // 토큰을 발급해 SQL 에 바인딩하고, 반환값은 그 토큰 그대로여야 한다. 타임스탬프를
    // 소유권 값으로 쓰면(정밀도·타임존·드라이버 직렬화) 세 번 깨졌다.
    expect(sql).toContain('lease_token');
    // ::uuid 캐스트가 빠지면 PG 가 text 바인딩과 uuid 컬럼을 맞추지 못해 실패한다.
    expect(sql).toContain('::uuid');
    // 만료시각은 DB 시계가 만든다 — 비교 대상이 아니므로 정밀도가 무관하고,
    // Date 를 raw sql 에 바인딩하다 드라이버가 터지던 라운드 3 회귀도 여기서 막힌다.
    expect(sql).toContain('now()');
    const { params } = renderQuery(trx.execute.mock.calls[0][0]);
    expect(params.some((p) => p instanceof Date)).toBe(false);
    expect(typeof claimed!.leaseToken).toBe('string');
    expect(claimed!.leaseToken).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(params).toContain(claimed!.leaseToken);
  });

  it('클레임마다 새 토큰을 발급한다 — 두 워커가 같은 토큰을 들면 CAS 가 무력해진다', async () => {
    const { manager } = makeHarness({ claimed: [{ id: 'sess-1' }] });

    const first = await manager.claimCommit();
    const second = await manager.claimCommit();

    expect(first!.leaseToken).not.toBe(second!.leaseToken);
  });

  it('클레임할 세션이 없으면 null 이다', async () => {
    const { manager } = makeHarness({ claimed: [] });
    expect(await manager.claimCommit()).toBeNull();
  });

  it('pending 행을 처리하고 아이템을 created 로 바꾼다', async () => {
    const { manager, updates, importManager } = makeHarness({ pendingItems: [PENDING(1), PENDING(2)] });

    await manager.runCommitSlice(CLAIM());

    expect(importManager.createFromRecord).toHaveBeenCalledTimes(2);
    const itemUpdates = updates.filter((u) => u.table === 'items');
    expect(itemUpdates[0].values).toMatchObject({ status: 'created', masterId: 'master-1' });
  });

  it('한 행이 터져도 나머지를 계속 처리하고 그 행만 failed 로 남긴다', async () => {
    const { manager, updates, importManager } = makeHarness({ pendingItems: [PENDING(1), PENDING(2)] });
    importManager.createFromRecord
      .mockRejectedValueOnce(new Error('productCode 중복'))
      .mockResolvedValueOnce('master-2');

    await manager.runCommitSlice(CLAIM());

    const itemUpdates = updates.filter((u) => u.table === 'items');
    expect(itemUpdates[0].values).toMatchObject({ status: 'failed', publishStatus: 'skipped' });
    expect(itemUpdates[0].values.errorMessage).toContain('productCode 중복');
    expect(itemUpdates[1].values).toMatchObject({ status: 'created' });
  });

  it('payload 형태가 어긋난 행은 그 행만 실패시킨다', async () => {
    const broken = { ...PENDING(1), payload: { productKey: 'P1' } };
    const { manager, updates, importManager } = makeHarness({ pendingItems: [broken] });

    await manager.runCommitSlice(CLAIM());

    expect(importManager.createFromRecord).not.toHaveBeenCalled();
    const itemUpdates = updates.filter((u) => u.table === 'items');
    expect(itemUpdates[0].values.errorMessage).toMatch(/다시 올려/);
  });

  it('남은 pending 이 없으면 세션을 completed 로 마감한다', async () => {
    const { manager, updates } = makeHarness({ pendingItems: [] });

    await manager.runCommitSlice(CLAIM());

    const done = updates.find((u) => u.table === 'sessions' && u.values.commitStatus === 'completed');
    expect(done).toBeDefined();
    expect(done!.values.leaseUntil).toBeNull();
    // 토큰도 같이 지운다 — 남기면 죽은 토큰이 행에 계속 붙어 있다.
    expect(done!.values.leaseToken).toBeNull();
    // 이전 슬라이스의 일시적 오류가 남아있으면 세션이 정상 완료돼도 API 에 영구
    // 노출된다(M-1) — 마감이 commitError 도 같이 지워야 한다.
    expect(done!.values.commitError).toBeNull();
  });

  it('마감도 CAS 로 소유권을 확인한다 — lease 를 잃은 좀비가 completed 를 도장 찍으면 안 된다', async () => {
    const { manager, updates } = makeHarness({ pendingItems: [] });

    await manager.runCommitSlice(CLAIM());

    // 무조건 쓰면(id 매치만), lease 만료 뒤 뒤늦게 깨어난 좀비가 pending 0 을 보고
    // **후임이 처리 중인 세션을** completed 로 만들고 committed_at 을 덮어쓰며 후임의
    // lease_until 까지 지운다. 마감도 renew·release 와 같은 토큰 CAS 여야 한다.
    const done = updates.find((u) => u.table === 'sessions' && u.values.commitStatus === 'completed');
    const { sql, params } = renderQuery(done!.condition);
    expect(sql.toLowerCase()).toMatch(/"lease_token"\s*=/);
    expect(params).toHaveLength(2); // id + 클레임 토큰 — id 매치만 남기면 1개가 되어 실패한다
    expect(params).toContain(CLAIM_TOKEN);
  });

  it('슬라이스를 마치면 lease 를 놓되 running 은 유지한다', async () => {
    const { manager, updates } = makeHarness({ pendingItems: [PENDING(1)] });

    await manager.runCommitSlice(CLAIM());

    const release = updates.filter((u) => u.table === 'sessions' && u.values.leaseUntil === null).at(-1);
    // 토큰도 같이 지운다 — 남겨두면 죽은 토큰이 행에 계속 붙어 있어 진단을 흐린다.
    expect(release!.values).toEqual({ leaseUntil: null, leaseToken: null });
  });

  it('슬라이스 종료 시 lease 해제는 CAS 로 소유권을 확인한다 — 내 lease_token 을 그대로 들고 있을 때만 지운다', async () => {
    const { manager, updates } = makeHarness({ pendingItems: [PENDING(1)] });

    await manager.runCommitSlice(CLAIM());

    // 무조건 지우거나(id 매치만) "만료됐으면" 지우면(gt/lt), lease 가 이미 넘어간 뒤
    // 뒤늦게 끝난 좀비 워커가 살아있는 후임 lease 를 지워버릴 수 있다. 반드시 "내가
    // 발급한 토큰" 인지 등호로 비교해야 한다 — id 매치만으로는 부족하다.
    const release = updates.filter((u) => u.table === 'sessions' && u.values.leaseUntil === null).at(-1);
    const { sql, params } = renderQuery(release!.condition);
    const lowered = sql.toLowerCase();
    expect(lowered).toMatch(/"lease_token"\s*=/); // 토큰 등호 CAS
    // 시각 비교로 되돌리면(생존검사든 등호든) 실패해야 한다.
    expect(lowered).not.toContain('lease_until');
    expect(lowered).not.toContain('>');
    expect(lowered).not.toContain('<');
    // 두 조건(id, lease_token) 이 모두 걸려 있어야 한다 — id 매치만 남기면 실패해야 한다.
    expect(params).toHaveLength(2);
    expect(params).toContain(CLAIM_TOKEN);
  });

  it('행마다 lease 를 갱신하는 update 도 CAS 로 소유권을 확인한다 — id 매치만으론 안 된다', async () => {
    const { manager, updates } = makeHarness({ pendingItems: [PENDING(1), PENDING(2)] });

    await manager.runCommitSlice(CLAIM());

    // renewLease 의 where 를 bare eq(id, sessionId) 로 줄이면(파라미터 1개) 이 테스트가
    // 실패해야 한다 — 중간에 세션을 뺏겨도 갱신이 계속 통과해버리는 회귀를 renew 쪽
    // 술어 자체에서 잡는다(release 쪽만 검사하면 이 회귀가 안 보인다).
    const renewals = renewalUpdates(updates);
    expect(renewals).toHaveLength(2);
    const { sql: sql0, params: params0 } = renderQuery(renewals[0].condition);
    const { sql: sql1, params: params1 } = renderQuery(renewals[1].condition);
    expect(sql0.toLowerCase()).toMatch(/"lease_token"\s*=/);
    expect(sql1.toLowerCase()).toMatch(/"lease_token"\s*=/);
    expect(params0).toHaveLength(2); // id + 클레임 토큰
    expect(params1).toHaveLength(2); // id + 클레임 토큰

    // 토큰은 클레임 한 번당 하나다 — 갱신할 때마다 새로 만들면(그리고 그걸 다음 CAS 기대값으로
    // 쓰면) 세션을 뺏긴 뒤에도 자기가 방금 쓴 값과 비교하게 되어 CAS 가 무력해진다.
    expect(params0).toContain(CLAIM_TOKEN);
    expect(params1).toContain(CLAIM_TOKEN);
  });

  it('갱신은 만료시각을 DB 시계로 민다 — JS Date 를 바인딩하지 않는다', async () => {
    // 라운드 3 회귀 방지: 만료시각은 CAS 비교 대상이 아니므로 DB 가 만들어야 정밀도·타임존·
    // 드라이버 직렬화 어디에도 걸리지 않는다. 여기서 Date 인스턴스가 나타나면 그 회귀다.
    const { manager, updates } = makeHarness({ pendingItems: [PENDING(1)] });

    await manager.runCommitSlice(CLAIM());

    const written = renewalUpdates(updates)[0].values.leaseUntil;
    expect(written).not.toBeInstanceOf(Date);
    expect(renderSql(written).toLowerCase()).toContain('now()');
  });

  it('renewLease 는 lease_token·lease_until 값은 읽지 않는다', async () => {
    // .returning() 이 lease_token·lease_until 에 완전히 엉뚱한 내용을 돌려줘도 — 행이
    // 존재하기만 하면(CAS 성공) 슬라이스는 그대로 진행한다. cancelRequestedAt 은 이제
    // 실제로 읽는다(취소 감지) — 보호 대상은 소유권 판정에 쓰이던 그 두 값이다. 그걸
    // 소유권 판정에 쓰려다 세 번 깨졌다(라운드 2·3).
    const { manager, importManager } = makeHarness({
      pendingItems: [PENDING(1)],
      returningRows: [[{ id: 'sess-1', leaseToken: 'not-a-real-uuid-🔥', cancelRequestedAt: null }]],
    });

    await manager.runCommitSlice(CLAIM());

    expect(importManager.createFromRecord).toHaveBeenCalledTimes(1);
  });

  it('행마다 lease 를 갱신한다 — 실패해서 continue 하는 행도 포함', async () => {
    const broken = { ...PENDING(2), payload: { productKey: 'P2' } }; // isProductRecord 가드에서 걸러지는 행
    const { manager, updates } = makeHarness({ pendingItems: [PENDING(1), broken, PENDING(3)] });

    await manager.runCommitSlice(CLAIM());

    // renewLease 는 leaseUntil 을 (null 이 아닌) 새 만료 시각으로 미는 update 다 —
    // createdCount 증가 update, 종료 시 release(leaseUntil: null) 와 구분해야 한다.
    // renewLease 를 가드 아래로 옮기면(continue 이전에서 빠지면) 3행 중 2번만 갱신되어
    // 이 개수가 어긋난다 — early-continue 경로도 lease 를 갱신해야 함을 증명한다.
    expect(renewalUpdates(updates)).toHaveLength(3);
  });

  it('lease 를 잃으면(CAS 실패) 슬라이스를 즉시 중단하고 남은 행을 처리하지도, 마무리 release 도 하지 않는다', async () => {
    const { manager, updates, importManager } = makeHarness({
      pendingItems: [PENDING(1), PENDING(2)],
      returningRows: [[]], // 빈 배열 = CAS 실패(이미 다른 워커가 가져감)
    });

    await manager.runCommitSlice(CLAIM());

    expect(importManager.createFromRecord).not.toHaveBeenCalled();
    const release = updates.find((u) => u.table === 'sessions' && u.values.leaseUntil === null);
    expect(release).toBeUndefined();
  });

  it('슬라이스마다 variantCode 충돌을 다시 본다', async () => {
    const { manager, variantCodeChecker } = makeHarness({ pendingItems: [PENDING(1)] });

    await manager.runCommitSlice(CLAIM());

    expect(variantCodeChecker.check).toHaveBeenCalled();
  });

  it('참조한 이미지가 실패 상태면 그 행을 실패시키고 createFromRecord 를 부르지 않는다', async () => {
    // 이 규칙이 이 단계의 핵심이다 — 배선(runCommitSlice)이 unresolvedImageError 를
    // 실제로 부르는지는 순수 함수 자체의 단위테스트(resolver.spec)로는 잡히지 않는다.
    // 스프레드로 새 리터럴을 만든다 — PENDING() 의 반환 타입에 없는 필드를 기존 변수에
    // 직접 대입하면(TS2339) 타입체크가 막는다.
    const base = PENDING(1);
    const item = { ...base, payload: { ...base.payload, thumbnailImageKey: 'IMG-1' } };
    const { manager, updates, importManager, reader } = makeHarness({ pendingItems: [item] });
    reader.getSessionImages.mockResolvedValue([
      { imageKey: 'IMG-1', usage: 'main', status: 'fetch_failed', fileId: null, errorMessage: '404' },
    ]);

    await manager.runCommitSlice(CLAIM());

    expect(importManager.createFromRecord).not.toHaveBeenCalled();
    const itemUpdates = updates.filter((u) => u.table === 'items');
    expect(itemUpdates[0].values).toMatchObject({ status: 'failed', publishStatus: 'skipped' });
    expect(itemUpdates[0].values.errorMessage).toContain('IMG-1');
    expect(itemUpdates[0].values.errorMessage).toContain('404');
  });

  it('참조한 이미지가 업로드 완료 상태면 createFromRecord 에 fileId 맵을 넘긴다', async () => {
    // 위 실패 케이스의 짝 — 실패 케이스만 있으면 "항상 실패시키는" 구현도 통과해버린다.
    const base = PENDING(2);
    const item = { ...base, payload: { ...base.payload, thumbnailImageKey: 'IMG-1' } };
    const { manager, importManager, reader } = makeHarness({ pendingItems: [item] });
    reader.getSessionImages.mockResolvedValue([
      { imageKey: 'IMG-1', usage: 'main', status: 'uploaded', fileId: 'file-9', errorMessage: null },
    ]);

    await manager.runCommitSlice(CLAIM());

    expect(importManager.createFromRecord).toHaveBeenCalledTimes(1);
    const [, , , images] = importManager.createFromRecord.mock.calls[0];
    expect(images.main.get('IMG-1')).toBe('file-9');
  });

  it('errors 필드가 없는 payload 는 그 행만 실패시키고 슬라이스를 탈출하지 않는다', async () => {
    const payload: Record<string, unknown> = { ...PENDING(1).payload };
    delete payload.errors;
    const broken = { ...PENDING(1), payload };
    const { manager, updates, importManager } = makeHarness({ pendingItems: [broken] });

    await expect(manager.runCommitSlice(CLAIM())).resolves.toBeUndefined();

    expect(importManager.createFromRecord).not.toHaveBeenCalled();
    const itemUpdates = updates.filter((u) => u.table === 'items');
    expect(itemUpdates[0].values).toMatchObject({ status: 'failed', publishStatus: 'skipped' });
  });

  it('recordJobError 는 오류만 기록하고 lease 는 건드리지 않는다', async () => {
    const { manager, updates } = makeHarness();

    await manager.recordJobError('sess-1', 'commit', '오류 메시지');

    const update = updates.find((u) => u.table === 'sessions');
    expect(update).toBeDefined();
    expect(update!.values).toMatchObject({ commitError: '오류 메시지' });
    // 탈출한 예외는 우리 상태를 모른다는 뜻이다 — lease 를 지우면(재도입되면) 이미
    // 세션을 넘겨받은 후임 워커의 살아있는 lease 를 지울 수 있다. 여기서 leaseUntil
    // 이나 leaseToken 이 다시 나타나면(null 이든 다른 값이든) 그 회귀다.
    expect(update!.values).not.toHaveProperty('leaseUntil');
    expect(update!.values).not.toHaveProperty('leaseToken');
  });

  it('슬라이스 밖 예외는 연속 실패를 올리기만 하고 레인 상태는 그대로 둔다', async () => {
    const { manager, updates } = makeHarness({ returningRows: [[{ consecutiveFailures: 3 }]] });

    await manager.recordJobError('sess-1', 'commit', 'DB 연결 끊김');

    // 일시적 DB 오류로 임포트를 영구 실패시키는 편이 더 나쁘다 — 상한 전까지는 재시도한다.
    expect(updates).toHaveLength(1);
    expect(updates[0].values.commitError).toBe('DB 연결 끊김');
    expect(updates[0].values.commitStatus).toBeUndefined();
    // returningRows 는 증가 *결과*를 흉내낼 뿐이라, 증가식 자체가 상수로 바뀌어도
    // 나머지 단정은 전부 통과한다. 카운터가 1에서 멈추면 상한이 영원히 발화하지 않는다.
    expect(renderSql(updates[0].values.consecutiveFailures).toLowerCase()).toContain('+ 1');
    expect(updates[0].values.leaseToken).toBeUndefined();
  });

  it('연속 실패가 상한에 닿으면 그 레인을 failed 로 확정하고 lease 를 놓는다', async () => {
    const { manager, updates } = makeHarness({
      returningRows: [[{ consecutiveFailures: MAX_CONSECUTIVE_JOB_FAILURES }]],
    });

    await manager.recordJobError('sess-1', 'publish', '알 수 없는 오류');

    expect(updates).toHaveLength(2);
    // 스키마에만 있고 아무도 쓰지 않던 'failed' 값이 드디어 쓰이는 자리다.
    expect(updates[1].values).toMatchObject({ publishStatus: 'failed', leaseUntil: null, leaseToken: null });
  });

  it('commit 레인의 상한도 commit_status 를 failed 로 만든다 — publish 로 고정되면 안 된다', async () => {
    const { manager, updates } = makeHarness({
      returningRows: [[{ consecutiveFailures: MAX_CONSECUTIVE_JOB_FAILURES + 5 }]],
    });

    await manager.recordJobError('sess-1', 'commit', '알 수 없는 오류');

    expect(updates[1].values).toMatchObject({ commitStatus: 'failed' });
    expect(updates[1].values.publishStatus).toBeUndefined();
  });

  it('연속 실패 리셋은 0 보다 클 때만 실제 행에 닿는다', async () => {
    const { manager, updates } = makeHarness();

    await manager.clearConsecutiveFailures('sess-1');

    expect(updates).toHaveLength(1);
    expect(updates[0].values).toEqual({ consecutiveFailures: 0 });
    expect(renderSql(updates[0].condition).toLowerCase()).toContain('"consecutive_failures" >');
  });

  it('클레임은 취소 요청된 세션을 집지 않는다 — 굳은 세션이 취소로 풀리는 경로다', async () => {
    const { manager, trx } = makeHarness({ claimed: [] });

    await manager.claimCommit();

    const sql = renderSql(trx.execute.mock.calls[0][0]).toLowerCase();
    // 이 조건이 없으면 취소된 세션도 계속 클레임돼 매 틱 같은 예외를 반복한다.
    expect(sql).toContain('cancel_requested_at is null');
  });

  it('게시 클레임도 같은 취소 가드를 건다', async () => {
    const { manager, trx } = makeHarness({ claimed: [] });

    await manager.claimPublish();

    expect(renderSql(trx.execute.mock.calls[0][0]).toLowerCase()).toContain('cancel_requested_at is null');
  });

  it('슬라이스 도중 취소가 감지되면 첫 행도 만들지 않고 lease 를 놓는다', async () => {
    const { manager, updates, importManager } = makeHarness({
      pendingItems: [PENDING(1), PENDING(2)],
      returningRows: [[{ id: 'sess-1', cancelRequestedAt: new Date() }]],
    });

    await manager.runCommitSlice(CLAIM());

    // 취소 검사는 행 처리보다 **먼저** 와야 한다 — 뒤에 두면 매 슬라이스마다 한 행씩 더 만든다.
    expect(importManager.createFromRecord).not.toHaveBeenCalled();
    // lease 를 놓는다: leaseToken 을 null 로 쓰는 세션 업데이트가 정확히 하나.
    const released = updates.filter((u) => u.table === 'sessions' && u.values.leaseToken === null);
    expect(released).toHaveLength(1);
  });

  it('마감은 취소된 세션을 completed 로 도장 찍지 않는다', async () => {
    const { manager, updates } = makeHarness({ pendingItems: [] });

    await manager.runCommitSlice(CLAIM());

    const [finalize] = updates.filter((u) => u.table === 'sessions');
    expect(finalize.values.commitStatus).toBe('completed');
    // 취소 직후 pending 이 0 인 경계에서 좀비 마감이 canceled 를 completed 로 덮는 것을 막는다.
    expect(renderSql(finalize.condition).toLowerCase()).toContain('cancel_requested_at" is null');
  });

  it('게시 마감도 같은 취소 가드를 건다', async () => {
    const { manager, updates } = makeHarness({ pendingItems: [] });

    await manager.runPublishSlice(CLAIM());

    const [finalize] = updates.filter((u) => u.table === 'sessions');
    expect(finalize.values.publishStatus).toBe('completed');
    expect(renderSql(finalize.condition).toLowerCase()).toContain('cancel_requested_at" is null');
  });
});

describe('runPublishSlice', () => {
  const CREATED = (rowNumber: number) => ({
    id: `item-${rowNumber}`,
    rowNumber,
    status: 'created',
    masterId: `master-${rowNumber}`,
    publishStatus: 'pending',
  });

  it('draft 버전을 게시하고 행을 published 로 바꾼다', async () => {
    const { manager, updates, versionsService } = makeHarness({ pendingItems: [CREATED(1)] });

    // brief 의 스니펫은 `runPublishSlice('sess-1')` 를 쓰지만 실제 시그니처는
    // ClaimedSession 이다(펜싱 토큰 라운드 4 가 확정한 계약) — commit 쪽 테스트와
    // 같은 CLAIM() 헬퍼로 맞춘다.
    await manager.runPublishSlice(CLAIM());

    expect(versionsService.publishVersion).toHaveBeenCalledWith('draft-1', expect.anything(), {
      origin: 'bulk_import',
      importSessionId: 'sess-1',
    });
    const itemUpdate = updates.find((u) => u.table === 'items');
    expect(itemUpdate!.values).toMatchObject({ publishStatus: 'published' });
    expect(itemUpdate!.values.publishedAt).toBeInstanceOf(Date);
  });

  it('draft 가 없으면 이미 게시된 것으로 보고 published 로 마감한다', async () => {
    const { manager, updates, reader, versionsService } = makeHarness({ pendingItems: [CREATED(1)] });
    reader.getDraftVersionId.mockResolvedValue(null);

    await manager.runPublishSlice(CLAIM());

    expect(versionsService.publishVersion).not.toHaveBeenCalled();
    expect(updates.find((u) => u.table === 'items')!.values).toMatchObject({ publishStatus: 'published' });
  });

  it('한 행이 터져도 나머지를 계속하고 그 행만 failed 로 남긴다', async () => {
    const { manager, updates, versionsService } = makeHarness({ pendingItems: [CREATED(1), CREATED(2)] });
    versionsService.publishVersion.mockRejectedValueOnce(new Error('productCode 중복'));

    await manager.runPublishSlice(CLAIM());

    const itemUpdates = updates.filter((u) => u.table === 'items');
    expect(itemUpdates[0].values).toMatchObject({ publishStatus: 'failed' });
    expect(itemUpdates[0].values.publishError).toContain('productCode 중복');
    expect(itemUpdates[1].values).toMatchObject({ publishStatus: 'published' });
  });

  it('남은 대상이 없으면 세션 publish 를 completed 로 마감한다', async () => {
    const { manager, updates } = makeHarness({ pendingItems: [] });

    await manager.runPublishSlice(CLAIM());

    const done = updates.find((u) => u.table === 'sessions' && u.values.publishStatus === 'completed');
    expect(done).toBeDefined();
    expect(done!.values.leaseUntil).toBeNull();
  });

  it('게시 마감도 CAS 로 소유권을 확인한다 — lease 를 잃은 좀비가 completed 를 도장 찍으면 안 된다', async () => {
    const { manager, updates } = makeHarness({ pendingItems: [] });

    await manager.runPublishSlice(CLAIM());

    // commit 마감 CAS 테스트와 같은 이유 — 무조건 쓰면(id 매치만) lease 를 잃은
    // 좀비가 후임이 처리 중인 세션에 completed 를 도장 찍고 lease 를 지운다.
    const done = updates.find((u) => u.table === 'sessions' && u.values.publishStatus === 'completed');
    const { sql, params } = renderQuery(done!.condition);
    expect(sql.toLowerCase()).toMatch(/"lease_token"\s*=/);
    expect(params).toHaveLength(2); // id + 클레임 토큰
    expect(params).toContain(CLAIM_TOKEN);
  });

  it('게시 슬라이스도 행마다 lease 를 갱신한다 — masterId 없어 continue 하는 행도 포함', async () => {
    // masterId 없는 행(가드에서 바로 continue)을 하나 섞는다 — commit 쪽 '실패해서
    // continue 하는 행도 포함' 테스트와 같은 이유다. renewLease 를 masterId 가드
    // 아래로 옮기면(가드 이전에서 빠지면) 2행 중 1개만 갱신되어 이 개수가 어긋난다 —
    // masterId 없는 행뿐인 슬라이스가 갱신 없이 조용히 lease 를 잃는 회귀를 잡는다.
    const { manager, updates } = makeHarness({
      pendingItems: [{ ...CREATED(1), masterId: null }, CREATED(2)],
    });

    await manager.runPublishSlice(CLAIM());

    expect(renewalUpdates(updates)).toHaveLength(2);
  });

  it('게시 lease 를 잃으면(CAS 실패) 슬라이스를 즉시 중단한다', async () => {
    const { manager, versionsService } = makeHarness({
      pendingItems: [CREATED(1), CREATED(2)],
      returningRows: [[]], // 빈 배열 = CAS 실패
    });

    await manager.runPublishSlice(CLAIM());

    expect(versionsService.publishVersion).not.toHaveBeenCalled();
  });

  it('masterId 가 없는 행은 그 행만 실패시킨다', async () => {
    const { manager, updates, versionsService } = makeHarness({
      pendingItems: [{ ...CREATED(1), masterId: null }],
    });

    await manager.runPublishSlice(CLAIM());

    expect(versionsService.publishVersion).not.toHaveBeenCalled();
    const itemUpdate = updates.find((u) => u.table === 'items');
    expect(itemUpdate!.values).toMatchObject({ publishStatus: 'failed' });
    expect(itemUpdate!.values.publishError).toMatch(/masterId/);
  });

  it('슬라이스를 마치면 lease 를 CAS 로 놓는다', async () => {
    const { manager, updates } = makeHarness({ pendingItems: [CREATED(1)] });

    await manager.runPublishSlice(CLAIM());

    const release = updates.filter((u) => u.table === 'sessions' && u.values.leaseUntil === null).at(-1);
    expect(release!.values).toEqual({ leaseUntil: null, leaseToken: null });
    const { params } = renderQuery(release!.condition);
    expect(params).toHaveLength(2);
    expect(params).toContain(CLAIM_TOKEN);
  });
});

const CLAIMED: ClaimedSession = { sessionId: 'sess-1', leaseToken: 'tok-1' };

function imageRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'img-1',
    sessionId: 'sess-1',
    imageKey: 'IMG-1',
    usage: 'main',
    sourceUrl: 'https://e.example/1.jpg',
    status: 'pending',
    fileId: null,
    mimeType: null,
    sizeBytes: null,
    errorMessage: null,
    ...over,
  };
}

function imageManager(
  harness: ReturnType<typeof makeHarness>,
  fetcher: { probe: jest.Mock; fetch: jest.Mock },
  fileClient: { upload: jest.Mock; softDelete: jest.Mock },
) {
  return new ProductImportJobManager(
    harness.db,
    undefined as never, // importManager — 이미지 슬라이스는 부르지 않는다
    { check: jest.fn() } as never, // variantCodeChecker
    { get: () => undefined } as never, // config → 전부 기본값
    undefined as never, // reader
    undefined as never, // versionsService
    fetcher as never,
    fileClient as never,
  );
}

describe('ProductImportJobManager — 이미지 레인', () => {
  const fetcher = { probe: jest.fn(), fetch: jest.fn() };
  const fileClient = { upload: jest.fn(), softDelete: jest.fn() };

  beforeEach(() => {
    fetcher.probe.mockReset();
    fetcher.fetch.mockReset();
    fileClient.upload.mockReset();
    fileClient.softDelete.mockReset();
  });

  it('pending 이 있으면 probe 를 돌고 상태를 probed 로 바꾼다', async () => {
    const harness = makeHarness({ imageRows: { pending: [imageRow()], probed: [] } });
    fetcher.probe.mockResolvedValue({ mimeType: 'image/jpeg', sizeBytes: 1234 });

    await imageManager(harness, fetcher, fileClient).runImageSlice(CLAIMED);

    expect(fetcher.probe).toHaveBeenCalledWith('https://e.example/1.jpg');
    const imageUpdate = harness.updates.find((u) => u.table === 'images');
    expect(imageUpdate.values).toMatchObject({ status: 'probed', mimeType: 'image/jpeg', sizeBytes: 1234 });
    // 마감은 아직이다 — pending 을 처리한 슬라이스는 lease 만 놓는다.
    expect(harness.updates.some((u) => u.table === 'sessions' && u.values.imageStatus === 'completed')).toBe(false);
  });

  it('probe 실패는 그 행만 probe_failed 로 만들고 슬라이스는 계속 돈다', async () => {
    const harness = makeHarness({
      imageRows: { pending: [imageRow({ id: 'img-1' }), imageRow({ id: 'img-2', imageKey: 'IMG-2' })], probed: [] },
    });
    fetcher.probe
      .mockRejectedValueOnce(new Error('DNS 실패'))
      .mockResolvedValueOnce({ mimeType: null, sizeBytes: null });

    await imageManager(harness, fetcher, fileClient).runImageSlice(CLAIMED);

    const imageUpdates = harness.updates.filter((u) => u.table === 'images');
    expect(imageUpdates[0].values).toMatchObject({ status: 'probe_failed', errorMessage: 'DNS 실패' });
    expect(imageUpdates[1].values).toMatchObject({ status: 'probed' });
  });

  it('pending 이 없으면 probed 를 fetch 해 업로드하고 uploaded 로 바꾼다', async () => {
    const harness = makeHarness({
      imageRows: { pending: [], probed: [imageRow({ status: 'probed', usage: 'description' })] },
    });
    fetcher.fetch.mockResolvedValue({ body: Buffer.from([1, 2]), mimeType: 'image/png', sizeBytes: 2 });
    fileClient.upload.mockResolvedValue({ fileId: 'file-9' });

    await imageManager(harness, fetcher, fileClient).runImageSlice(CLAIMED);

    expect(fileClient.upload).toHaveBeenCalledWith(
      expect.objectContaining({ usage: 'description', mimeType: 'image/png', userId: 'u1' }),
    );
    const imageUpdate = harness.updates.find((u) => u.table === 'images');
    expect(imageUpdate.values).toMatchObject({ status: 'uploaded', fileId: 'file-9', sizeBytes: 2 });
  });

  it('용도별 크기 상한 중 작은 쪽을 쓴다 (main 은 10MB)', async () => {
    const harness = makeHarness({ imageRows: { pending: [], probed: [imageRow({ status: 'probed' })] } });
    fetcher.fetch.mockResolvedValue({ body: Buffer.from([1]), mimeType: 'image/jpeg', sizeBytes: 1 });
    fileClient.upload.mockResolvedValue({ fileId: 'f-1' });

    await imageManager(harness, fetcher, fileClient).runImageSlice(CLAIMED);

    expect(fetcher.fetch).toHaveBeenCalledWith('https://e.example/1.jpg', 10 * 1024 * 1024, 15_000);
  });

  it('fetch/업로드 실패는 그 행만 fetch_failed 로 만들고 예외가 슬라이스를 탈출하지 않는다', async () => {
    const harness = makeHarness({ imageRows: { pending: [], probed: [imageRow({ status: 'probed' })] } });
    fetcher.fetch.mockRejectedValue(new Error('크기 상한 초과'));

    await expect(imageManager(harness, fetcher, fileClient).runImageSlice(CLAIMED)).resolves.toBeUndefined();

    const imageUpdate = harness.updates.find((u) => u.table === 'images');
    expect(imageUpdate.values).toMatchObject({ status: 'fetch_failed', errorMessage: '크기 상한 초과' });
  });

  it(
    '업로드는 성공했는데 fileId 는 아직 없다 — fetch 자체가 실패하면 fetch_failed 행의 fileId 는 null 이다(§finding4 대조군)',
    async () => {
      const harness = makeHarness({ imageRows: { pending: [], probed: [imageRow({ status: 'probed' })] } });
      fetcher.fetch.mockRejectedValue(new Error('연결 끊김'));

      await imageManager(harness, fetcher, fileClient).runImageSlice(CLAIMED);

      const imageUpdate = harness.updates.find((u) => u.table === 'images');
      expect(imageUpdate.values).toMatchObject({ status: 'fetch_failed', fileId: null });
    },
  );

  it(
    '업로드는 성공했는데 그 직후 상태 기록이 실패하면, 재시도(fetch_failed) 행에 fileId 를 함께 남긴다 — ' +
      '안 남기면 그 파일이 cleaner 의 fileId IS NOT NULL 필터에서 영영 빠져 S3 에 고아로 남는다(§finding4)',
    async () => {
      fetcher.fetch.mockResolvedValue({ body: Buffer.from([1]), mimeType: 'image/jpeg', sizeBytes: 1 });
      fileClient.upload.mockResolvedValue({ fileId: 'file-orphan' });

      const updates: Array<{ table: unknown; values: Record<string, unknown> }> = [];
      let imageSelectCallIndex = 0;
      let imagesUpdateCallIndex = 0;
      const trx = {
        select: (_projection?: unknown) => ({
          from: (table: unknown) => ({
            where: () => {
              if (table === productImportImages) {
                // runImageSlice 는 pending 을 먼저 조회한다(빈 배열 → probed 로 넘어간다).
                const rows = imageSelectCallIndex === 0 ? [] : [imageRow({ status: 'probed' })];
                imageSelectCallIndex += 1;
                return chain(rows);
              }
              return chain([{ id: 'sess-1', uploadedBy: 'u1' }]);
            },
          }),
        }),
        update: (table: unknown) => ({
          set: (values: Record<string, unknown>) => ({
            where: () => {
              updates.push({ table, values });
              if (table === productImportImages) {
                imagesUpdateCallIndex += 1;
                // 첫 updateImage 호출('uploaded' 확정) 만 실패시킨다 — Postgres 연결
                // 유실 등 트랜잭션 밖 원인을 흉내낸다. 두 번째 호출(catch 의 fetch_failed
                // 기록)은 성공해야 그 결과를 단정할 수 있다.
                if (imagesUpdateCallIndex === 1) return Promise.reject(new Error('연결 끊김'));
                return Promise.resolve();
              }
              const result: { returning: () => Promise<unknown[]> } = {
                returning: () => Promise.resolve([{ id: 'sess-1', cancelRequestedAt: null }]),
              };
              return Object.assign(Promise.resolve(), result);
            },
          }),
        }),
      };
      const db = { run: (fn: (t: unknown) => unknown, t?: unknown) => (t ? fn(t) : fn(trx)) } as never;
      const manager = new ProductImportJobManager(
        db,
        undefined as never,
        { check: jest.fn() } as never,
        { get: () => undefined } as never,
        undefined as never,
        undefined as never,
        fetcher as never,
        fileClient as never,
      );

      await expect(manager.runImageSlice(CLAIMED)).resolves.toBeUndefined();

      const imageUpdates = updates.filter((u) => u.table === productImportImages);
      expect(imageUpdates).toHaveLength(2);
      expect(imageUpdates[1].values).toMatchObject({ status: 'fetch_failed', fileId: 'file-orphan' });
    },
  );

  it('pending·probed 가 모두 없으면 image 레인을 마감하고 commit 레인을 연다', async () => {
    const harness = makeHarness({ imageRows: { pending: [], probed: [] } });

    await imageManager(harness, fetcher, fileClient).runImageSlice(CLAIMED);

    const [sessionUpdate] = harness.updates.filter((u) => u.table === 'sessions');
    expect(sessionUpdate.values).toMatchObject({
      imageStatus: 'completed',
      // 커밋 레인의 게이트를 여는 유일한 지점이다
      commitStatus: 'queued',
      leaseUntil: null,
      leaseToken: null,
      imageError: null,
    });
    // 마감도 토큰 CAS + 취소 가드를 건다 — 좀비가 후임의 세션에 도장을 찍지 못하게.
    const rendered = renderQuery(sessionUpdate.condition);
    expect(rendered.params).toContain('tok-1');
    expect(rendered.sql).toMatch(/cancel_requested_at.*is null/i);
  });

  it('lease 를 잃으면 아무 행도 처리하지 않고 멈춘다', async () => {
    // renewLease 의 returning 이 0행 → owned:false
    const harness = makeHarness({ imageRows: { pending: [imageRow()], probed: [] }, returningRows: [[]] });

    await imageManager(harness, fetcher, fileClient).runImageSlice(CLAIMED);

    expect(fetcher.probe).not.toHaveBeenCalled();
    expect(harness.updates.some((u) => u.table === 'images')).toBe(false);
  });

  it('취소를 감지하면 lease 만 놓고 멈춘다', async () => {
    const harness = makeHarness({
      imageRows: { pending: [imageRow()], probed: [] },
      returningRows: [[{ id: 'sess-1', cancelRequestedAt: new Date() }]],
    });

    await imageManager(harness, fetcher, fileClient).runImageSlice(CLAIMED);

    expect(fetcher.probe).not.toHaveBeenCalled();
    const [sessionUpdate] = harness.updates.filter((u) => u.table === 'sessions' && u.values.leaseToken === null);
    expect(sessionUpdate.values).toMatchObject({ leaseUntil: null, leaseToken: null });
    // 레인 상태는 cancelSession 이 이미 확정했다 — 워커는 덮지 않는다.
    expect(sessionUpdate.values.imageStatus).toBeUndefined();
  });

  it('recordJobError 가 image kind 를 image_error 에 쓰고 상한에서 레인을 failed 로 만든다', async () => {
    const harness = makeHarness({
      returningRows: [[{ consecutiveFailures: MAX_CONSECUTIVE_JOB_FAILURES }]],
    });

    await imageManager(harness, fetcher, fileClient).recordJobError('sess-1', 'image', 'boom');

    const sessionUpdates = harness.updates.filter((u) => u.table === 'sessions');
    expect(sessionUpdates[0].values.imageError).toBe('boom');
    expect(sessionUpdates[1].values).toMatchObject({ imageStatus: 'failed', leaseUntil: null, leaseToken: null });
  });
});
