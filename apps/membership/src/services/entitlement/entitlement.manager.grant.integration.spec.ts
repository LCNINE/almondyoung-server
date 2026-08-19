/**
 * 관리자 지급(grantByDays)의 아웃박스 원자 기록 — 실제 Postgres 통합.
 *
 * 유닛 스펙(entitlement.manager.grant.spec.ts)은 tx 목으로 "같은 tx 객체를 넘긴다"까지만
 * 증명한다. 여기서는 마이그레이션이 적용된 실 DB 에서 실제 발행 체인
 * (MembershipEventPublisher → StreamPublisher.enqueue → OutboxPublisher.write)을 태워,
 * ① 지급 커밋과 함께 `event.outbox_events` 에 행이 실제로 남는지(스키마 검증 포함),
 * ② 아웃박스 기록 실패 시 지급 인서트 전부가 실 DB 트랜잭션으로 롤백되는지를 고정한다.
 *
 * DATABASE_URL 이 없으면 통째로 skip 된다 — `npx jest` 기본 게이트에서는 돌지 않는다.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- postgres publishes `export =`; Jest compiles CJS.
import postgres = require('postgres');
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { StreamPublisher, OutboxPublisher } from '@app/events';
import { MEMBERSHIP_STREAM } from '@packages/event-contracts/streams';
import { EntitlementManager } from './entitlement.manager';
import { MembershipEventPublisher } from '../membership-event.publisher';
import * as schema from '../../shared/schemas/entities/schema';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('EntitlementManager.grantByDays 아웃박스 원자성 (PostgreSQL 통합)', () => {
  jest.setTimeout(60_000);

  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;
  let tierId: string;
  let planId: string;
  const userIds: string[] = [];

  const newUserId = () => {
    const id = `it-grant-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    userIds.push(id);
    return id;
  };

  function realPublisher() {
    const streamPublisher = new StreamPublisher(
      // 적재 경로만 태운다 — transport 에는 닿지 않는다.
      { send: async () => undefined } as never,
      MEMBERSHIP_STREAM,
      'entitlement-grant-itest',
      undefined,
      undefined,
      undefined,
      new OutboxPublisher({ db } as never),
    );
    return new MembershipEventPublisher(streamPublisher as never);
  }

  beforeAll(async () => {
    client = postgres(DATABASE_URL as string, { max: 2, prepare: false });
    db = drizzle(client);
    const [tier] = await db
      .insert(schema.tiers)
      .values({ code: `it-tier-${Date.now()}`, priorityLevel: 900000 + Math.floor(Math.random() * 90000) })
      .returning();
    tierId = tier.id;
    const [planRow] = await db
      .insert(schema.plan)
      .values({ tierId, price: 10000, durationDays: 30, isActive: true })
      .returning();
    planId = planRow.id;
  });

  afterAll(async () => {
    try {
      if (userIds.length > 0) {
        await client`delete from subscription_contract_events where user_id = any(${client.array(userIds)})`;
        await client`delete from subscription_entitlement where user_id = any(${client.array(userIds)})`;
        await client`delete from subscription_contracts where user_id = any(${client.array(userIds)})`;
        await client`delete from event.outbox_events where aggregate_id = any(${client.array(userIds)})`;
        await client`delete from event_batches where type = 'GRANTED_BY_ADMIN' and admin_id = 'admin-it'`;
      }
      if (planId) await client`delete from plan where id = ${planId}::uuid`;
      if (tierId) await client`delete from tiers where id = ${tierId}::uuid`;
    } finally {
      await client.end({ timeout: 5 });
    }
  });

  it('지급 커밋과 함께 MembershipStatusChanged(ACTIVE) 가 event.outbox_events 에 남는다', async () => {
    const userId = newUserId();
    const manager = new EntitlementManager({ db } as never, realPublisher());

    const result = await manager.grantByDays(userId, 30, 'itest memo', 'admin-it');

    const [entitlement] = await db
      .select()
      .from(schema.subscriptionEntitlement)
      .where(eq(schema.subscriptionEntitlement.userId, userId));
    expect(entitlement).toBeDefined();
    expect(entitlement.isCurrent).toBe(true);
    expect(entitlement.tierId).toBe(tierId);

    const outboxRows = await client`
      select event_type, aggregate_id, status, payload
      from event.outbox_events
      where aggregate_id = ${userId}
    `;
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0].event_type).toBe('MembershipStatusChanged');
    expect(outboxRows[0].status).toBe('PENDING');
    const envelopePayload = outboxRows[0].payload?.payload;
    expect(envelopePayload).toMatchObject({
      userId,
      status: 'ACTIVE',
      contractId: result.contractId,
      planId,
      tierId,
    });
  });

  it('아웃박스 기록이 실패하면 지급 인서트 전부가 실 DB 에서 롤백된다', async () => {
    const userId = newUserId();
    const failingPublisher = {
      saveStatusChanged: jest.fn().mockRejectedValue(new Error('outbox insert failed')),
    };
    const manager = new EntitlementManager({ db } as never, failingPublisher as never);

    await expect(manager.grantByDays(userId, 30, null, 'admin-it')).rejects.toThrow('outbox insert failed');

    const entitlements = await db
      .select()
      .from(schema.subscriptionEntitlement)
      .where(eq(schema.subscriptionEntitlement.userId, userId));
    const contracts = await db
      .select()
      .from(schema.subscriptionContracts)
      .where(eq(schema.subscriptionContracts.userId, userId));
    expect(entitlements).toHaveLength(0);
    expect(contracts).toHaveLength(0);
  });
});
