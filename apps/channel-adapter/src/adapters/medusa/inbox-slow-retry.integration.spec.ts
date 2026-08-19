/**
 * #677 순서역전 레이스의 실 DB 재현 — 실제 Postgres 위에서 inbox 워커의 클레임 SQL 과
 * SlowRetryInboxError 장기 재시도를 끝까지 태운다.
 *
 * 유닛 스펙은 claim/handleFailure 를 목 DB 로 본다. 여기서 고정하는 것:
 * ① 고객 미존재 실패가 기본 한도(5회)를 넘겨도 failed 가 아니라 pending 으로 남는지
 * ② next_attempt_at 이 1시간 캡으로 실제 저장되고, 클레임 SQL 이 그 미래 시각을 존중하는지
 * ③ 그 사이 Medusa 고객이 생기면(첫 로그인) 다음 재시도가 성공해 그룹 추가까지 가는지
 * ④ 일반 에러는 실 DB 에서도 기존 5회 한도로 failed 되는지 (회귀 확인)
 *
 * DATABASE_URL 이 없으면 통째로 skip 된다 — `npx jest` 기본 게이트에서는 돌지 않는다.
 * 클레임 SQL 은 테이블 전체에서 가장 오래된 pending 을 집으므로, 공용 dev DB 가 아니라
 * 비어 있는 전용 DB(예: channel_adapter_itest)를 대상으로 돌려야 한다.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- postgres publishes `export =`; Jest compiles CJS.
import postgres = require('postgres');
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { InboxWorkerService } from './inbox-worker.service';
import { MembershipMedusaSyncService } from './membership-medusa-sync.service';
import { inboxEvents } from '../../schema';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const GROUP_ID = 'cusgroup_itest';

describeIfDb('Inbox 슬로우 재시도 — 고객 미존재 순서역전 (PostgreSQL 통합)', () => {
  jest.setTimeout(60_000);

  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;
  let prevGroupId: string | undefined;
  const createdIds: string[] = [];

  const medusaClient = {
    findCustomerByAlmondUserId: jest.fn(),
    findCustomerByEmail: jest.fn().mockResolvedValue(null),
    addCustomerToGroup: jest.fn().mockResolvedValue('added'),
    refreshCustomerCartPrices: jest.fn().mockResolvedValue(undefined),
    issuePromotionsByTrigger: jest.fn().mockResolvedValue({ issued: 0, skipped: 0 }),
  };

  function createWorker() {
    const syncService = new MembershipMedusaSyncService(
      medusaClient as never,
      { trackEffect: jest.fn().mockResolvedValue(undefined) } as never,
      { getActiveUserIds: jest.fn().mockResolvedValue([]) } as never,
    );
    return new InboxWorkerService(
      { db } as never,
      {} as never,
      syncService,
      {} as never,
      medusaClient as never,
      {} as never,
      {} as never,
      { get: jest.fn(() => undefined) } as never,
      { runWithChain: jest.fn((_c: string, _e: string, fn: () => Promise<void>) => fn()) } as never,
    );
  }

  async function insertEvent(params: { userId: string; attempts: number }) {
    const [row] = await db
      .insert(inboxEvents)
      .values({
        eventType: 'MembershipStatusChanged',
        aggregateType: 'Membership',
        aggregateId: params.userId,
        partitionKey: params.userId,
        payload: { userId: params.userId, status: 'ACTIVE', occurredAt: new Date().toISOString() },
        metadata: {},
        status: 'pending',
        attempts: params.attempts,
        nextAttemptAt: new Date(Date.now() - 1000),
      })
      .returning({ id: inboxEvents.id });
    createdIds.push(row.id);
    return row.id;
  }

  async function claimAndProcess(worker: InboxWorkerService) {
    const claimed = await (worker as never as { claimNextInboxEvent(): Promise<{ id: string } | null> })
      .claimNextInboxEvent();
    if (claimed) {
      await (worker as never as { processInboxEvent(e: unknown): Promise<void> }).processInboxEvent(claimed);
    }
    return claimed;
  }

  async function loadEvent(id: string) {
    const [row] = await db.select().from(inboxEvents).where(eq(inboxEvents.id, id));
    return row;
  }

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 2, prepare: false });
    db = drizzle(client);
    prevGroupId = process.env.MEDUSA_MEMBERSHIP_GROUP_ID;
    process.env.MEDUSA_MEMBERSHIP_GROUP_ID = GROUP_ID;
  });

  afterAll(async () => {
    try {
      if (createdIds.length > 0) {
        await client`delete from inbox_events where id = any(${client.array(createdIds)}::uuid[])`;
      }
    } finally {
      if (prevGroupId === undefined) delete process.env.MEDUSA_MEMBERSHIP_GROUP_ID;
      else process.env.MEDUSA_MEMBERSHIP_GROUP_ID = prevGroupId;
      await client.end({ timeout: 5 });
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    medusaClient.findCustomerByAlmondUserId.mockResolvedValue(null);
    medusaClient.findCustomerByEmail.mockResolvedValue(null);
    medusaClient.addCustomerToGroup.mockResolvedValue('added');
    medusaClient.refreshCustomerCartPrices.mockResolvedValue(undefined);
    medusaClient.issuePromotionsByTrigger.mockResolvedValue({ issued: 0, skipped: 0 });
  });

  it('고객 미존재는 기본 한도 너머에서도 pending + 1시간 캡 재시도로 남고, 고객이 생기면 성공한다', async () => {
    const userId = `it-user-${Date.now()}-a`;
    const eventId = await insertEvent({ userId, attempts: 14 });
    const worker = createWorker();

    // 1) 클레임(→ attempts 15) 후 고객 미존재 실패
    const before = Date.now();
    const claimed = await claimAndProcess(worker);
    expect(claimed?.id).toBe(eventId);

    let row = await loadEvent(eventId);
    expect(row.status).toBe('pending'); // 기본 한도(5) 를 이미 넘겼지만 failed 가 아니다
    expect(row.attempts).toBe(15);
    expect(row.errorMessage).toContain('Medusa customer not found');
    expect(row.nextAttemptAt).not.toBeNull();
    const delayMs = (row.nextAttemptAt as Date).getTime() - before;
    expect(delayMs).toBeGreaterThan(55 * 60 * 1000); // 2^15초는 캡에 걸려 1시간
    expect(delayMs).toBeLessThanOrEqual(61 * 60 * 1000);

    // 2) next_attempt_at 이 미래인 동안 클레임 SQL 이 이 행을 집지 않는다
    await expect(
      (worker as never as { claimNextInboxEvent(): Promise<unknown> }).claimNextInboxEvent(),
    ).resolves.toBeNull();

    // 3) 고객이 첫 로그인으로 생김 + 재시도 시각 도래 → 다음 클레임이 성공 처리한다
    medusaClient.findCustomerByAlmondUserId.mockResolvedValue({ id: 'cus_it_1', email: 'it@example.com' });
    await db.update(inboxEvents).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(eq(inboxEvents.id, eventId));

    const reclaimed = await claimAndProcess(worker);
    expect(reclaimed?.id).toBe(eventId);

    row = await loadEvent(eventId);
    expect(row.status).toBe('published');
    expect(row.publishedAt).not.toBeNull();
    expect(medusaClient.addCustomerToGroup).toHaveBeenCalledWith('cus_it_1', GROUP_ID);
    expect(medusaClient.refreshCustomerCartPrices).toHaveBeenCalledWith('cus_it_1');
  });

  it('일반 에러는 실 DB 에서도 기존 5회 한도로 failed 된다', async () => {
    const userId = `it-user-${Date.now()}-b`;
    const eventId = await insertEvent({ userId, attempts: 4 });
    medusaClient.findCustomerByAlmondUserId.mockResolvedValue({ id: 'cus_it_2', email: 'it2@example.com' });
    medusaClient.addCustomerToGroup.mockRejectedValue(new Error('medusa 5xx'));
    const worker = createWorker();

    const claimed = await claimAndProcess(worker);
    expect(claimed?.id).toBe(eventId);

    const row = await loadEvent(eventId);
    expect(row.status).toBe('failed');
    expect(row.attempts).toBe(5);
    expect(row.failedAt).not.toBeNull();
    expect(row.errorMessage).toContain('medusa 5xx');
  });
});
