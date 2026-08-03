// product-import-job.manager → product-import.manager → product-masters.service 가
// '@packages/event-contracts' 를 bare specifier 로 import 한다. jest moduleNameMapper 는
// 서브패스만 매핑하므로 여기서도 가상 모킹이 필요하다 (단위 스펙 두 개와 같은 이유).
jest.mock(
  '@packages/event-contracts',
  () => ({ PRODUCT_STREAM: { topic: { topic: 'products.events.v1' }, aggregateType: 'Product' } }),
  { virtual: true },
);

import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DbService } from '@app/db';
import { catalogSchema, type PimSchema } from '../../../schema/catalog.schema';
import { ProductImportJobManager, MAX_CONSECUTIVE_JOB_FAILURES } from './product-import-job.manager';
import type { ProductImportManager } from './product-import.manager';
import type { ProductImportVariantCodeChecker } from './product-import-variant-code.checker';
import type { ProductImportSessionReader } from './product-import-session.reader';
import type { ProductVersionsService } from '../../../core/products/services/product-versions.service';
import type { ProductImportImageFetcher } from './product-import-image.fetcher';
import type { ProductImportFileClient } from './product-import-file.client';

/**
 * lease 소유권(claim → renew → release)과 마감을 **진짜 Postgres** 에 대고 구동한다.
 *
 * 이 스펙이 존재하는 이유: 소유권 확인이 세 번 연속으로 깨졌는데 세 번 다 목 기반
 * 단위 스펙에는 보이지 않았다. 하네스가 `.returning()` 을 where 절과 무관하게
 * 돌려주므로 (1) 생존검사를 소유권검사로 착각하거나 (2) 절대 일치할 수 없는 등호
 * CAS 를 쓰거나 (3) 드라이버가 직렬화하지 못하는 값을 바인딩해도 전부 초록이었다.
 * 여기서는 실제 SQL 이 실제 행에 어떻게 작용하는지만 본다.
 *
 * **격리**: 일회용 스키마를 만들고 세 커넥션 전부의 search_path 를 거기로 돌린다.
 * `claimCommit()` 의 SQL 에는 세션을 골라내는 필터가 없다(가장 오래된 자격 세션을
 * 집는 게 본래 동작이다) — public 스키마에 붙이면 남의 큐 대기 임포트를 집어
 * `running` 으로 만들어 놓고 되돌리지 않는다. 스키마를 갈아버리면 애초에 그 행이
 * 보이지 않으므로 문제 자체가 사라진다.
 * (선례: shipment-dispatch-persistence.integration.spec.ts:24-28,
 *  scripts/fulfillment-v2/cleanup.integration.spec.ts:39-42)
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_PRODUCT_IMPORT_LEASE_DB === '1' && !DATABASE_URL) {
  throw new Error('DATABASE_URL is required for the product import lease integration suite.');
}
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const LEASE_MS = 30_000;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * 일회용 스키마로 search_path 가 고정된 커넥션. `SET search_path` 문 대신 접속
 * startup 파라미터로 넘긴다 — `SET` 은 세션 단위라 postgres.js 가 (idle timeout 등으로)
 * 물리 재연결하면 조용히 public 으로 되돌아간다. startup 파라미터는 재연결 때마다
 * 다시 적용되므로 max:1 여부와 무관하게 안전하다.
 */
function connect(url: string, schema: string): postgres.Sql {
  return postgres(url, { max: 1, prepare: false, connection: { search_path: schema } });
}

/**
 * 워커 하나를 흉내낸다 — 자기 커넥션과 자기 ProductImportJobManager 를 가진다.
 * 두 개를 만들면 "롤링 배포로 태스크가 잠시 둘" 인 상황이 그대로 재현된다.
 */
function makeWorkerLike(client: postgres.Sql) {
  const db = drizzle(client, { schema: catalogSchema });
  const dbService = {
    db,
    run: <T>(fn: (t: never) => Promise<T>, tx?: never): Promise<T> =>
      tx ? fn(tx) : db.transaction((t) => fn(t as never)),
  } as unknown as DbService<PimSchema>;
  const manager = new ProductImportJobManager(
    dbService,
    // 이 스펙은 lease 원장(claim/renew/release/마감)만 구동한다 — commit·publish·image
    // 세 레인의 행 생성/게시/업로드 협력자는 pending 행이 0 이라 한 번도 호출되지 않으므로
    // (퍼블리시 케이스도 대상 없음 finalize 경로만 돈다) 스텁조차 필요 없다.
    undefined as unknown as ProductImportManager,
    undefined as unknown as ProductImportVariantCodeChecker,
    new ConfigService({ PRODUCT_IMPORT_LEASE_MS: String(LEASE_MS) }),
    undefined as unknown as ProductImportSessionReader,
    undefined as unknown as ProductVersionsService,
    undefined as unknown as ProductImportImageFetcher,
    undefined as unknown as ProductImportFileClient,
  );
  // renewLease/releaseLease 는 private 이다 — 대괄호 접근은 TS 가 허용하는 표준 우회로이고
  // `as` 캐스트 없이 시그니처를 그대로 유지한다.
  return {
    manager,
    renew: (sessionId: string, token: string): Promise<{ owned: boolean; canceled: boolean }> =>
      manager['renewLease'](sessionId, token),
    release: (sessionId: string, token: string): Promise<void> => manager['releaseLease'](sessionId, token),
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describeIfDb('product import 잡 lease 소유권 (DB 통합)', () => {
  jest.setTimeout(120_000);

  const schemaName = `pi_lease_${randomUUID().replaceAll('-', '')}`;
  let admin: postgres.Sql;
  let clientA: postgres.Sql;
  let clientB: postgres.Sql;
  let a: ReturnType<typeof makeWorkerLike>;
  let b: ReturnType<typeof makeWorkerLike>;

  beforeAll(async () => {
    // 스키마 자체는 이름이 이미 한정돼 있으니 search_path 없이도 만들 수 있다 —
    // 이 커넥션 하나로 끝내고 닫는다.
    const bootstrap = postgres(DATABASE_URL as string, { max: 1, prepare: false });
    await bootstrap.unsafe(`CREATE SCHEMA "${schemaName}"`);
    await bootstrap.end();

    // admin 도 startup 파라미터로 search_path 를 고정한다 — 이후 admin 이 쓰는 문(CREATE
    // TABLE, 시딩, beforeEach 의 DELETE, readLease 의 SELECT) 은 전부 비한정 테이블명이라
    // 재연결로 public 에 떨어지면 남의 행을 건드리게 된다.
    admin = postgres(DATABASE_URL as string, { max: 1, prepare: false, connection: { search_path: schemaName } });
    // public 의 실제 DDL 을 그대로 복제한다 — 손으로 옮겨 적으면 스키마가 갈라지고,
    // 그렇게 갈라진 테이블에 대고 통과하는 테스트는 아무 것도 증명하지 못한다.
    // (enum 컬럼 타입은 생성 시점에 public 의 타입 OID 로 해석되므로 그대로 따라온다.)
    await admin.unsafe(`CREATE TABLE product_import_sessions (LIKE public.product_import_sessions INCLUDING ALL)`);
    await admin.unsafe(`CREATE TABLE product_import_items (LIKE public.product_import_items INCLUDING ALL)`);

    clientA = connect(DATABASE_URL as string, schemaName);
    clientB = connect(DATABASE_URL as string, schemaName);
    a = makeWorkerLike(clientA);
    b = makeWorkerLike(clientB);
  });

  afterAll(async () => {
    // DROP SCHEMA 도 이름이 이미 한정돼 있어 search_path 되돌리기가 필요 없다.
    // 각 클라이언트를 optional chaining 으로 개별 가드한다 — beforeAll 이 admin 생성
    // 뒤·clientA/B 생성 전에 던지면 clientA/B 는 undefined 다. 무가드 Promise.all 은
    // 그 자리에서 거부돼 admin.end() 가 아예 호출되지 못하고 jest 가 열린 핸들로 멈춘다.
    await admin?.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
    await Promise.all([clientA?.end(), clientB?.end(), admin?.end()]);
  });

  beforeEach(async () => {
    // 우리 스키마이므로 통째로 비운다 — 남의 행은 애초에 여기 없다.
    await admin`DELETE FROM product_import_sessions`;
  });

  /** claim 이 집을 수 있는 queued 세션 하나(commit 클레임 대상 — publish_status 는 idle). */
  async function seedQueuedSession(): Promise<string> {
    const id = randomUUID();
    await admin`
      INSERT INTO product_import_sessions (id, file_name, total_rows, status, commit_status)
      VALUES (${id}, ${'it-lease-' + id}, 0, 'completed', 'queued')
    `;
    return id;
  }

  /**
   * claimPublish 가 집을 수 있는 세션 하나 — commit 은 이미 completed(실제 흐름대로
   * commit 이 끝나야 게시 대상이 생긴다), publish_status 만 queued.
   */
  async function seedQueuedPublishSession(): Promise<string> {
    const id = randomUUID();
    await admin`
      INSERT INTO product_import_sessions (id, file_name, total_rows, status, commit_status, publish_status)
      VALUES (${id}, ${'it-lease-' + id}, 0, 'completed', 'completed', 'queued')
    `;
    return id;
  }

  /** 취소 요청이 찍힌 세션 하나 — 레인은 cancelSession 이 확정한 대로 canceled 다. */
  async function seedCanceledSession(): Promise<string> {
    const id = randomUUID();
    await admin`
      INSERT INTO product_import_sessions
             (id, file_name, total_rows, status, commit_status, cancel_requested_at)
      VALUES (${id}, ${'it-cancel-' + id}, 0, 'completed', 'canceled', NOW())
    `;
    return id;
  }

  async function readLease(sessionId: string) {
    const [row] = await admin`
      SELECT commit_status,
             publish_status,
             lease_token,
             lease_until,
             committed_at,
             cancel_requested_at,
             consecutive_failures,
             EXTRACT(EPOCH FROM lease_until)::float8 AS lease_epoch,
             (lease_until > NOW()) AS is_live
        FROM product_import_sessions
       WHERE id = ${sessionId}
    `;
    return row as {
      commit_status: string;
      publish_status: string;
      lease_token: string | null;
      lease_until: unknown;
      committed_at: unknown;
      cancel_requested_at: unknown;
      consecutive_failures: number;
      lease_epoch: number | null;
      is_live: boolean | null;
    };
  }

  it('클레임은 토큰을 발급하고 세션을 running 으로 바꾼다', async () => {
    const sessionId = await seedQueuedSession();

    const claimed = await a.manager.claimCommit();

    expect(claimed).not.toBeNull();
    expect(claimed!.sessionId).toBe(sessionId);
    expect(claimed!.leaseToken).toMatch(UUID_V7);

    const row = await readLease(sessionId);
    expect(row.commit_status).toBe('running');
    // DB 에 실제로 박힌 토큰이 우리가 들고 있는 값과 같아야 한다 — 이후 CAS 가 전부 이 등식에 걸린다.
    expect(row.lease_token).toBe(claimed!.leaseToken);
    expect(row.is_live).toBe(true);
  });

  it('claim → renew → renew → release: 올바른 토큰의 갱신은 성공하며 lease_until 을 앞으로 민다', async () => {
    const sessionId = await seedQueuedSession();
    const claimed = await a.manager.claimCommit();
    expect(claimed).not.toBeNull();
    const afterClaim = await readLease(sessionId);

    await sleep(60);
    expect((await a.renew(sessionId, claimed!.leaseToken)).owned).toBe(true);
    const afterFirst = await readLease(sessionId);
    expect(afterFirst.lease_epoch!).toBeGreaterThan(afterClaim.lease_epoch!);
    // 토큰은 갱신해도 그대로다 — 클레임 한 번에 토큰 하나.
    expect(afterFirst.lease_token).toBe(claimed!.leaseToken);

    await sleep(60);
    expect((await a.renew(sessionId, claimed!.leaseToken)).owned).toBe(true);
    const afterSecond = await readLease(sessionId);
    expect(afterSecond.lease_epoch!).toBeGreaterThan(afterFirst.lease_epoch!);

    await a.release(sessionId, claimed!.leaseToken);
    const afterRelease = await readLease(sessionId);
    // release 는 lease 만 놓는다 — commit_status 는 running 그대로여야 다음 틱이 이어받는다.
    expect(afterRelease.lease_until).toBeNull();
    expect(afterRelease.lease_token).toBeNull();
    expect(afterRelease.commit_status).toBe('running');
  });

  it('틀린 토큰으로는 갱신되지 않고 lease_until 도 움직이지 않는다', async () => {
    const sessionId = await seedQueuedSession();
    const claimed = await a.manager.claimCommit();
    const before = await readLease(sessionId);

    await sleep(60);
    const renewed = await b.renew(sessionId, randomUUID());

    expect(renewed.owned).toBe(false);
    const after = await readLease(sessionId);
    expect(after.lease_epoch).toBe(before.lease_epoch);
    expect(after.lease_token).toBe(claimed!.leaseToken);
  });

  it('틀린 토큰으로는 해제되지 않는다', async () => {
    const sessionId = await seedQueuedSession();
    const claimed = await a.manager.claimCommit();

    await b.release(sessionId, randomUUID());

    const after = await readLease(sessionId);
    expect(after.lease_token).toBe(claimed!.leaseToken);
    expect(after.lease_until).not.toBeNull();
  });

  it('lease 가 살아있는 동안 두 번째 워커는 잡지 못하고, 만료된 뒤에는 잡는다', async () => {
    const sessionId = await seedQueuedSession();
    const first = await a.manager.claimCommit();
    expect(first!.sessionId).toBe(sessionId);

    // lease 가 살아있다 → 자격 세션이 하나도 없다(이 스키마엔 이 행뿐이다).
    expect(await b.manager.claimCommit()).toBeNull();
    // 우리 행이 건드려지지 않았음도 직접 본다.
    expect((await readLease(sessionId)).lease_token).toBe(first!.leaseToken);

    // lease 만료(= 처리하던 프로세스가 죽었다)
    await admin`UPDATE product_import_sessions SET lease_until = NOW() - interval '1 minute' WHERE id = ${sessionId}`;

    const takeover = await b.manager.claimCommit();
    expect(takeover).not.toBeNull();
    expect(takeover!.sessionId).toBe(sessionId);
    // 인수한 워커는 **새 토큰**을 발급한다. 같은 토큰이면 펜싱이 성립하지 않는다.
    expect(takeover!.leaseToken).not.toBe(first!.leaseToken);
    expect((await readLease(sessionId)).lease_token).toBe(takeover!.leaseToken);

    // 펜싱의 핵심: 뒤늦게 깨어난 좀비 A 는 자기 토큰으로 아무 것도 하지 못한다.
    // `lease_until > NOW()` 생존검사였다면 후임이 방금 민 미래 시각을 통과해
    // 후임의 lease 를 갱신하거나 지워버렸을 것이다.
    expect((await a.renew(sessionId, first!.leaseToken)).owned).toBe(false);
    await a.release(sessionId, first!.leaseToken);
    const stillHeld = await readLease(sessionId);
    expect(stillHeld.lease_token).toBe(takeover!.leaseToken);
    expect(stillHeld.is_live).toBe(true);
  });

  it('pending 행이 없으면 마감한다 — completed + committed_at + lease 정리', async () => {
    const sessionId = await seedQueuedSession();
    const claimed = await a.manager.claimCommit();

    await a.manager.runCommitSlice(claimed!);

    const after = await readLease(sessionId);
    expect(after.commit_status).toBe('completed');
    expect(after.committed_at).not.toBeNull();
    expect(after.lease_until).toBeNull();
    expect(after.lease_token).toBeNull();
  });

  it('lease 를 잃은 좀비는 마감하지 못한다 — 후임의 세션에 completed 를 도장 찍으면 안 된다', async () => {
    const sessionId = await seedQueuedSession();
    const zombie = await a.manager.claimCommit();

    // 좀비의 lease 가 만료되고 후임이 인수한다.
    await admin`UPDATE product_import_sessions SET lease_until = NOW() - interval '1 minute' WHERE id = ${sessionId}`;
    const takeover = await b.manager.claimCommit();
    expect(takeover!.leaseToken).not.toBe(zombie!.leaseToken);
    const beforeZombie = await readLease(sessionId);

    // 좀비가 뒤늦게 깨어나 pending 0 을 보고 마감을 시도한다.
    await a.manager.runCommitSlice(zombie!);

    const after = await readLease(sessionId);
    // 마감이 CAS 없이 무조건 쓰였다면 여기서 completed 가 되고 committed_at 이 찍히며
    // 후임의 lease_until 이 지워진다 — 그 회귀를 진짜 DB 에서 잡는다.
    expect(after.commit_status).toBe('running');
    expect(after.committed_at).toBeNull();
    expect(after.lease_token).toBe(takeover!.leaseToken);
    expect(after.lease_epoch).toBe(beforeZombie.lease_epoch);
    expect(after.is_live).toBe(true);
  });

  // ─── publish 레인 (Task 7) ───
  // renewLease/releaseLease 는 commit·publish 어느 쪽 claim 이 발급한 토큰이든 컬럼
  // 이름과 무관하게 동일한 CAS 술어(id + lease_token 등호)로 동작한다 — claim() 자체가
  // `column` 인자로 commit_status/publish_status 만 바꿔 끼우는 같은 구현이기 때문이다.
  // 그래도 퍼블리시 클레임이 실제로 publish_status 를 건드리고 그 토큰이 renew/마감과
  // 진짜로 맞물리는지는 여기서 직접 봐야 한다 — 목 하네스로는 볼 수 없는 지점이다.

  it('클레임(publish)은 토큰을 발급하고 세션의 publish_status 를 running 으로 바꾼다', async () => {
    const sessionId = await seedQueuedPublishSession();

    const claimed = await a.manager.claimPublish();

    expect(claimed).not.toBeNull();
    expect(claimed!.sessionId).toBe(sessionId);
    expect(claimed!.leaseToken).toMatch(UUID_V7);

    const row = await readLease(sessionId);
    expect(row.publish_status).toBe('running');
    expect(row.lease_token).toBe(claimed!.leaseToken);
    expect(row.is_live).toBe(true);
  });

  it('퍼블리시 클레임 토큰도 같은 renew CAS 를 쓴다 — 올바른 토큰은 성공하고, 틀린 토큰은 거부된다', async () => {
    const sessionId = await seedQueuedPublishSession();
    const claimed = await a.manager.claimPublish();
    const before = await readLease(sessionId);

    await sleep(60);
    expect((await b.renew(sessionId, randomUUID())).owned).toBe(false);
    const afterWrong = await readLease(sessionId);
    expect(afterWrong.lease_epoch).toBe(before.lease_epoch);
    expect(afterWrong.lease_token).toBe(claimed!.leaseToken);

    expect((await a.renew(sessionId, claimed!.leaseToken)).owned).toBe(true);
    const afterRight = await readLease(sessionId);
    expect(afterRight.lease_epoch!).toBeGreaterThan(before.lease_epoch!);
    expect(afterRight.lease_token).toBe(claimed!.leaseToken);
    // renew 는 status 를 건드리지 않는다 — 클레임이 세워둔 running 이 그대로여야 한다.
    expect(afterRight.publish_status).toBe('running');
  });

  it('게시 대상이 없으면 publish_status 를 completed 로 마감한다', async () => {
    const sessionId = await seedQueuedPublishSession();
    const claimed = await a.manager.claimPublish();

    await a.manager.runPublishSlice(claimed!);

    const after = await readLease(sessionId);
    expect(after.publish_status).toBe('completed');
    expect(after.lease_until).toBeNull();
    expect(after.lease_token).toBeNull();
  });

  it('게시 lease 를 잃은 좀비는 마감하지 못한다 — 후임의 세션에 completed 를 도장 찍으면 안 된다', async () => {
    const sessionId = await seedQueuedPublishSession();
    const zombie = await a.manager.claimPublish();

    // 좀비의 lease 가 만료되고 후임이 인수한다.
    await admin`UPDATE product_import_sessions SET lease_until = NOW() - interval '1 minute' WHERE id = ${sessionId}`;
    const takeover = await b.manager.claimPublish();
    expect(takeover!.leaseToken).not.toBe(zombie!.leaseToken);
    const beforeZombie = await readLease(sessionId);

    // 좀비가 뒤늦게 깨어나 게시 대상 0 을 보고 마감을 시도한다.
    await a.manager.runPublishSlice(zombie!);

    const after = await readLease(sessionId);
    // 마감이 CAS 없이 무조건 쓰였다면 여기서 completed 가 되고 후임의 lease_until 이
    // 지워진다 — commit 쪽과 같은 회귀를 publish 쪽에서도 진짜 DB 로 잡는다.
    expect(after.publish_status).toBe('running');
    expect(after.lease_token).toBe(takeover!.leaseToken);
    expect(after.lease_epoch).toBe(beforeZombie.lease_epoch);
    expect(after.is_live).toBe(true);
  });

  it('클레임은 취소 요청된 세션을 집지 않는다 — 굳은 세션의 재시도 루프가 여기서 끊긴다', async () => {
    await seedCanceledSession();

    expect(await a.manager.claimCommit()).toBeNull();
  });

  it('취소 요청만 있고 레인이 아직 queued 여도 집지 않는다 — 두 조건이 독립적으로 막는다', async () => {
    const sessionId = await seedQueuedSession();
    await admin`UPDATE product_import_sessions SET cancel_requested_at = NOW() WHERE id = ${sessionId}`;

    expect(await a.manager.claimCommit()).toBeNull();
  });

  it('renewLease 는 소유권을 유지한 채 취소 요청을 읽어 온다', async () => {
    const sessionId = await seedQueuedSession();
    const claimed = await a.manager.claimCommit();

    // 클레임 이후에 취소가 들어온 상황 — 진행 중 슬라이스가 감지해야 하는 유일한 경로다.
    await admin`UPDATE product_import_sessions SET cancel_requested_at = NOW() WHERE id = ${sessionId}`;

    const lease = await a.renew(sessionId, claimed!.leaseToken);
    expect(lease).toEqual({ owned: true, canceled: true });
  });

  it('취소가 없으면 renewLease 는 canceled:false 다', async () => {
    const sessionId = await seedQueuedSession();
    const claimed = await a.manager.claimCommit();

    expect(await a.renew(sessionId, claimed!.leaseToken)).toEqual({ owned: true, canceled: false });
  });

  it('마감은 취소된 세션을 completed 로 덮지 않는다', async () => {
    const sessionId = await seedQueuedSession();
    const claimed = await a.manager.claimCommit();
    await admin`UPDATE product_import_sessions
                   SET cancel_requested_at = NOW(), commit_status = 'canceled'
                 WHERE id = ${sessionId}`;

    // pending 행이 0 이라 마감 경로로 들어간다(협력자는 한 번도 호출되지 않는다).
    await a.manager.runCommitSlice(claimed!);

    const row = await readLease(sessionId);
    expect(row.commit_status).toBe('canceled');
    expect(row.committed_at).toBeNull();
  });

  it('연속 실패가 상한에 닿으면 레인이 failed 로 확정되고 lease 가 풀린다', async () => {
    const sessionId = await seedQueuedSession();
    const claimed = await a.manager.claimCommit();
    expect(claimed).not.toBeNull();

    for (let i = 0; i < MAX_CONSECUTIVE_JOB_FAILURES; i += 1) {
      await a.manager.recordJobError(sessionId, 'commit', `반복 오류 ${i}`);
    }

    const row = await readLease(sessionId);
    expect(row.consecutive_failures).toBe(MAX_CONSECUTIVE_JOB_FAILURES);
    expect(row.commit_status).toBe('failed');
    expect(row.lease_token).toBeNull();
    // failed 레인은 claim 후보가 아니다 — 무한 재시도가 여기서 끝난다.
    expect(await a.manager.claimCommit()).toBeNull();
  });

  it('상한 직전까지는 레인을 건드리지 않는다', async () => {
    const sessionId = await seedQueuedSession();
    const claimed = await a.manager.claimCommit();

    for (let i = 0; i < MAX_CONSECUTIVE_JOB_FAILURES - 1; i += 1) {
      await a.manager.recordJobError(sessionId, 'commit', `일시적 오류 ${i}`);
    }

    const row = await readLease(sessionId);
    expect(row.commit_status).toBe('running');
    expect(row.lease_token).toBe(claimed!.leaseToken);
  });

  it('정상 종료한 슬라이스의 리셋이 카운터를 0 으로 되돌린다', async () => {
    const sessionId = await seedQueuedSession();
    await a.manager.claimCommit();
    await a.manager.recordJobError(sessionId, 'commit', '일시적 오류');

    await a.manager.clearConsecutiveFailures(sessionId);

    expect((await readLease(sessionId)).consecutive_failures).toBe(0);
  });
});
