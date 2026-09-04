// eslint-disable-next-line @typescript-eslint/no-require-imports -- postgres publishes `export =`; Jest compiles CJS.
import postgres = require('postgres');
import { drizzle } from 'drizzle-orm/postgres-js';
import { CouponIssueReconciliationService } from './coupon-issue-reconciliation.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/**
 * 빠른 레인의 술어 두 개는 **실 Postgres 에서만** 증명된다:
 *   1. `metadata -> 'coupon_fast_reset' is null` 이 NULL metadata 와 키 없음을 **둘 다** 잡는가
 *   2. `coalesce(metadata,'{}') || jsonb_build_object(...)` 가 기존 키를 보존하며 마커를 더하는가
 * 목으로는 둘 다 조용히 통과한다 — 그래서 이 파일이 있다.
 */
describeIfDb('쿠폰 빠른 레인 (PostgreSQL integration)', () => {
  // `describe.skip` 도 콜백 본문은 실행된다 — 연결은 `beforeAll` 에서 만든다(skip 시 안 돈다).
  let client: ReturnType<typeof postgres>;
  let service: CouponIssueReconciliationService;
  const createdIds: string[] = [];

  // id 컬럼에는 DB 기본값이 없다 — drizzle 스키마가 $defaultFn(uuidv7) 로 애플리케이션에서 채운다.
  // 생 SQL 로 넣을 때는 이쪽이 직접 만들어야 한다.
  const insertFailed = async (metadata: string | null): Promise<string> => {
    const [row] = await client<{ id: string }[]>`
      insert into inbox_events
        (id, event_type, aggregate_type, aggregate_id, partition_key, payload, metadata,
         status, attempts, failed_at, error_message)
      values
        (gen_random_uuid(), 'MembershipStatusChanged', 'Membership', ${`p7-${Math.random()}`}, 'pk',
         '{"userId":"u1"}'::jsonb, ${metadata}::jsonb, 'failed', 5, now(), 'boom')
      returning id
    `;
    createdIds.push(row.id);
    return row.id;
  };

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 4, prepare: false });
    const db = drizzle(client);
    service = new CouponIssueReconciliationService({ db } as never);
  });

  afterAll(async () => {
    if (createdIds.length > 0) {
      await client`delete from inbox_events where id = any(${client.array(createdIds)}::uuid[])`;
    }
    await client.end({ timeout: 5 });
  });

  it('metadata 가 NULL 인 행도 되살리고, 두 번째 회차에는 건드리지 않는다', async () => {
    const id = await insertFailed(null);

    await service.sweepRecentFailures();
    const [afterFirst] = await client`select status, attempts, metadata from inbox_events where id = ${id}`;
    expect(afterFirst.status).toBe('pending');
    expect(Number(afterFirst.attempts)).toBe(0);
    expect(afterFirst.metadata).toHaveProperty('coupon_fast_reset');

    // 다시 실패시킨 뒤 두 번째 회차 — 마커가 있으므로 되살아나면 안 된다.
    await client`update inbox_events set status = 'failed', failed_at = now() where id = ${id}`;
    await service.sweepRecentFailures();
    const [afterSecond] = await client`select status from inbox_events where id = ${id}`;
    expect(afterSecond.status).toBe('failed');
  });

  it('기존 metadata 키를 보존하며 마커를 더한다', async () => {
    const id = await insertFailed('{"correlationId":"corr-1"}');

    await service.sweepRecentFailures();

    const [row] = await client`select metadata from inbox_events where id = ${id}`;
    expect(row.metadata).toMatchObject({ correlationId: 'corr-1' });
    expect(row.metadata).toHaveProperty('coupon_fast_reset');
  });
});
