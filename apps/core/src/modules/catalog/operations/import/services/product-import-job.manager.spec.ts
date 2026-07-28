jest.mock(
  '@packages/event-contracts',
  () => ({ PRODUCT_STREAM: { topic: { topic: 'products.events.v1' }, aggregateType: 'Product' } }),
  { virtual: true },
);

import { PgDialect } from 'drizzle-orm/pg-core';
import { ProductImportJobManager, ClaimedSession } from './product-import-job.manager';
import { productImportSessions, productImportItems } from '../../../schema/catalog.schema';

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

function makeHarness(opts: { pendingItems?: any[]; claimed?: any[]; renewalRows?: any[][] } = {}) {
  const updates: any[] = [];
  const pending = opts.pendingItems ?? [];
  let renewalCallIndex = 0;

  const trx = {
    // execute 는 실제로 sql 인자 하나를 받는다 — 시그니처를 무인자로 두면
    // `mock.calls[0][0]` 접근이 빈 튜플 인덱싱으로 타입 에러가 난다.
    execute: jest.fn(async (_query?: unknown) => opts.claimed ?? []),
    select: (_projection?: any) => ({
      from: (table: any) => ({
        where: () => chain(table === productImportItems ? pending : [{ id: 'sess-1', uploadedBy: 'u1' }]),
      }),
    }),
    update: (table: any) => ({
      set: (values: any) => ({
        // condition 도 남겨둔다 — release/renew 가 CAS 로 소유권을 확인하는지는
        // where 절 자체를 렌더링해야 단정할 수 있다(값만 보면 SET 절과 구분이 안 된다).
        where: (condition?: unknown) => {
          updates.push({ table: table === productImportSessions ? 'sessions' : 'items', values, condition });
          const result: any = Promise.resolve();
          // renewLease 만 .returning() 을 체이닝한다. 라운드 3 수정 이후 실제 코드는
          // 이 결과의 **존재 여부(행이 있는가)** 만 보고 내용은 절대 읽지 않는다 — 그래서
          // harness 도 완전히 엉뚱한 내용을 돌려줘 그 사실을 증명할 수 있게 열어 둔다.
          // opts.renewalRows 를 안 주면 항상 성공(비어있지 않은 행)으로 취급한다.
          result.returning = (_projection?: unknown) => {
            const rows = opts.renewalRows
              ? opts.renewalRows[Math.min(renewalCallIndex, opts.renewalRows.length - 1)]
              : [{ id: 'sess-1' }];
            renewalCallIndex += 1;
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
  const reader = { getDraftVersionId: jest.fn(async () => 'draft-1') } as any;
  const versionsService = { publishVersion: jest.fn(async () => undefined) } as any;
  const manager = new ProductImportJobManager(db, importManager, variantCodeChecker, config, reader, versionsService);
  return { manager, updates, trx, importManager, variantCodeChecker, reader, versionsService };
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

  it('renewLease 는 .returning() 의 내용을 읽지 않고 행 존재 여부만 본다', async () => {
    // .returning() 이 완전히 엉뚱한 내용을 돌려줘도 — 행이 존재하기만 하면(CAS 성공)
    // 슬라이스는 그대로 진행한다. 내용을 파싱하기 시작하면 라운드 2·3 이 반복된다.
    const { manager, importManager } = makeHarness({
      pendingItems: [PENDING(1)],
      renewalRows: [[{ id: 'sess-1', leaseToken: 'not-a-real-uuid-🔥' }]],
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
      renewalRows: [[]], // 빈 배열 = CAS 실패(이미 다른 워커가 가져감)
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

    expect(versionsService.publishVersion).toHaveBeenCalledWith('draft-1', expect.anything());
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
      renewalRows: [[]], // 빈 배열 = CAS 실패
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
