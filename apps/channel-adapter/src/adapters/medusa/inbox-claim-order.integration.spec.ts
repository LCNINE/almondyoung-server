import { randomUUID } from 'crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { InboxWorkerService } from './inbox-worker.service';
import { channelAdapterSchema } from '../../schema';
// eslint-disable-next-line @typescript-eslint/no-require-imports -- postgres publishes `export =`; Jest compiles CJS.
import postgres = require('postgres');

/**
 * 클레임 쿼리의 **정렬 결과**를 진짜 Postgres 에 대고 본다.
 *
 * 이 스펙이 존재하는 이유: 강등 판정에 jsonb 항이 붙으면서 NULL 함정이 생겼다.
 * `COALESCE` 없이 `event_type = 'X' OR metadata->>'origin' = 'bulk_import'` 를 쓰면
 * 마커 없는 행이 `false OR NULL` = NULL 이 되고, NULL 은 ASC 에서 맨 뒤로 간다.
 * 즉 우선 레인과 후순위 레인이 통째로 뒤바뀌는데 **에러는 안 난다**. 렌더된 SQL
 * 문자열 단정으로는 `COALESCE` 의 존재만 보일 뿐 이 뒤집힘을 증명하지 못한다.
 *
 * **격리**: 일회용 스키마를 만들고 커넥션의 search_path 를 startup 파라미터로 거기
 * 고정한다. `SET search_path` 는 세션 단위라 postgres.js 가 재연결하면 조용히 public
 * 으로 돌아가고, 그러면 클레임이 진짜 큐의 행을 집어 `processing` 으로 만들어 놓고
 * 되돌리지 않는다. (선례: product-import-job-lease.integration.spec.ts:48-56)
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_INBOX_CLAIM_ORDER_DB === '1' && !DATABASE_URL) {
  throw new Error('DATABASE_URL is required for the inbox claim order integration suite.');
}
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** 클레임된 행이 되돌아오지 않도록 충분히 긴 lease. */
const LEASE_MS = 15 * 60 * 1000;

const T0 = new Date('2026-07-29T00:00:00.000Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

describeIfDb('inbox 클레임 레인 강등 순서 (DB 통합)', () => {
  jest.setTimeout(120_000);

  const schemaName = `inbox_order_${randomUUID().replaceAll('-', '')}`;
  let admin: postgres.Sql;
  let client: postgres.Sql;
  let service: InboxWorkerService;

  beforeAll(async () => {
    const bootstrap = postgres(DATABASE_URL as string, { max: 1, prepare: false });
    await bootstrap.unsafe(`CREATE SCHEMA "${schemaName}"`);
    await bootstrap.end();

    admin = postgres(DATABASE_URL as string, {
      max: 1,
      prepare: false,
      connection: { search_path: schemaName },
    });
    // public 의 실제 DDL 을 복제한다 — 손으로 옮겨 적으면 스키마가 갈라지고,
    // 갈라진 테이블에 대고 통과하는 테스트는 아무 것도 증명하지 못한다.
    await admin.unsafe(`CREATE TABLE inbox_events (LIKE public.inbox_events INCLUDING ALL)`);

    client = postgres(DATABASE_URL as string, {
      max: 1,
      prepare: false,
      connection: { search_path: schemaName },
    });

    const db = drizzle(client, { schema: channelAdapterSchema });
    const configService = {
      get: jest.fn((key: string) => (key === 'INBOX_PROCESSING_LEASE_MS' ? String(LEASE_MS) : undefined)),
    };

    // 이 스펙은 claimNextInboxEvent 만 구동한다 — 핸들러 협력자 일곱은 한 번도
    // 호출되지 않으므로 스텁조차 필요 없다.
    service = new InboxWorkerService(
      { db } as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      configService as never,
      undefined as never,
    );
  });

  afterAll(async () => {
    await admin?.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
    await Promise.all([client?.end(), admin?.end()]);
  });

  beforeEach(async () => {
    await admin`DELETE FROM inbox_events`;
  });

  async function seed(row: {
    eventType: string;
    createdAt: Date;
    metadata: Record<string, string> | null;
  }): Promise<string> {
    const id = randomUUID();
    await admin`
      INSERT INTO inbox_events
        (id, event_type, aggregate_type, aggregate_id, partition_key,
         payload, metadata, status, attempts, next_attempt_at, created_at)
      VALUES
        (${id}, ${row.eventType}, 'Product', ${'agg-' + id}, ${'agg-' + id},
         ${admin.json({ masterId: 'master-1' })},
         ${row.metadata === null ? null : admin.json(row.metadata)},
         'pending', 0, ${row.createdAt}, ${row.createdAt})
    `;
    return id;
  }

  /** 클레임을 반복해 순서를 뽑는다. private 메서드는 대괄호 접근으로 시그니처를 보존한다. */
  async function claimAll(count: number): Promise<string[]> {
    const claimed: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const event = await service['claimNextInboxEvent']();
      if (!event) break;
      claimed.push(event.id);
    }
    return claimed;
  }

  it('마커 없는 행이 더 최신이어도 대량 행보다 먼저 클레임된다', async () => {
    // 후순위 레인 — 가장 오래된 두 건.
    const bulkImport = await seed({
      eventType: 'ProductMasterActiveVersionChanged',
      createdAt: at(0),
      metadata: { messageId: 'm-bulk', origin: 'bulk_import' },
    });
    const sellableQty = await seed({
      eventType: 'ProductSellableQuantityChanged',
      createdAt: at(1),
      metadata: { messageId: 'm-qty' },
    });

    // 우선 레인 — 전부 위 두 건보다 새롭다.
    const singlePublish = await seed({
      eventType: 'ProductMasterActiveVersionChanged',
      createdAt: at(2),
      metadata: { messageId: 'm-single' },
    });
    const membership = await seed({
      eventType: 'MembershipStatusChanged',
      createdAt: at(3),
      metadata: { messageId: 'm-membership' },
    });
    const legacyNullMetadata = await seed({
      eventType: 'ProductMasterActiveVersionChanged',
      createdAt: at(4),
      metadata: null,
    });

    expect(await claimAll(5)).toEqual([
      // 우선 레인이 created_at ASC 로 먼저
      singlePublish,
      membership,
      legacyNullMetadata,
      // 그 다음 후순위 레인이 created_at ASC 로
      bulkImport,
      sellableQty,
    ]);
  });

  it('metadata 가 NULL 이거나 origin 키가 없는 행을 강등하지 않는다', async () => {
    // COALESCE 가 빠지면 이 두 건이 NULL 로 평가돼 맨 뒤로 밀린다.
    const nullMetadata = await seed({
      eventType: 'ProductMasterActiveVersionChanged',
      createdAt: at(0),
      metadata: null,
    });
    const noOriginKey = await seed({
      eventType: 'ProductMasterActiveVersionChanged',
      createdAt: at(1),
      metadata: { messageId: 'm-1' },
    });
    const demoted = await seed({
      eventType: 'ProductSellableQuantityChanged',
      createdAt: at(2),
      metadata: { messageId: 'm-2' },
    });

    expect(await claimAll(3)).toEqual([nullMetadata, noOriginKey, demoted]);
  });
});
