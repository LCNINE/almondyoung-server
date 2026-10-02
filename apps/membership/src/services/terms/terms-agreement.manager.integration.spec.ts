/**
 * 약관 동의 이력 — 실제 Postgres 통합.
 *
 * 동의가 «행으로» 남는지, 그리고 가입 요청이 가져온 동의를 남의 것·다른 플랜·다른 결제 방식·
 * 이미 쓰인 것이면 거절하는지를 실 DB 에서 고정한다. 목은 WHERE 절을 안 읽으므로 이걸 증명하지 못한다.
 *
 * DATABASE_URL 이 없으면 통째로 skip 된다 — `npx jest` 기본 게이트에서는 돌지 않는다.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- postgres publishes `export =`; Jest compiles CJS.
import postgres = require('postgres');
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { TermsAgreementManager } from './terms-agreement.manager';
import { CURRENT_MEMBERSHIP_TERMS_VERSION } from './membership-terms';
import * as schema from '../../shared/schemas/entities/schema';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('TermsAgreementManager 동의 이력 (PostgreSQL 통합)', () => {
  jest.setTimeout(60_000);

  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;
  let manager: TermsAgreementManager;
  let tierId: string;
  let planId: string;
  let otherPlanId: string;
  const contractIds: string[] = [];
  const userIds: string[] = [];

  const newUserId = () => {
    const id = `it-terms-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    userIds.push(id);
    return id;
  };
  const newContract = async (userId: string) => {
    const [row] = await db
      .insert(schema.subscriptionContracts)
      .values({ userId, planId, status: 'ACTIVE', billingDate: '2026-09-01' })
      .returning();
    contractIds.push(row.id);
    return row.id;
  };
  const agree = (userId: string, billingMode: 'recurring' | 'one_time' = 'recurring') =>
    manager.record({ userId, termsVersion: CURRENT_MEMBERSHIP_TERMS_VERSION, billingMode, planId });

  beforeAll(async () => {
    client = postgres(DATABASE_URL as string, { max: 2, prepare: false });
    db = drizzle(client);
    manager = new TermsAgreementManager({ db } as never, { get: () => 'false' } as never);

    const [tier] = await db
      .insert(schema.tiers)
      .values({ code: `it-terms-tier-${Date.now()}`, priorityLevel: 700000 + Math.floor(Math.random() * 90000) })
      .returning();
    tierId = tier.id;
    const plans = await db
      .insert(schema.plan)
      .values([
        { tierId, price: 4990, durationDays: 30, isActive: true },
        { tierId, price: 49900, durationDays: 365, isActive: true },
      ])
      .returning();
    planId = plans[0].id;
    otherPlanId = plans[1].id;
  });

  afterAll(async () => {
    try {
      if (userIds.length > 0) {
        await client`delete from membership_terms_agreements where user_id = any(${client.array(userIds)})`;
      }
      if (contractIds.length > 0) {
        await client`delete from subscription_contracts where id = any(${client.array(contractIds)}::uuid[])`;
      }
      if (tierId) {
        await client`delete from plan where tier_id = ${tierId}::uuid`;
        await client`delete from tiers where id = ${tierId}::uuid`;
      }
    } finally {
      await client.end({ timeout: 5 });
    }
  });

  it('동의가 누가·언제·어느 버전·어느 플랜·어느 결제 방식으로 행에 남는다', async () => {
    const userId = newUserId();
    const before = new Date();

    const { agreementId } = await agree(userId);

    const [row] = await db
      .select()
      .from(schema.membershipTermsAgreements)
      .where(eq(schema.membershipTermsAgreements.id, agreementId));
    expect(row.userId).toBe(userId);
    expect(row.termsVersion).toBe(CURRENT_MEMBERSHIP_TERMS_VERSION);
    expect(row.planId).toBe(planId);
    expect(row.billingMode).toBe('recurring');
    expect(row.contractId).toBeNull();
    expect(row.agreedAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 5_000);
  });

  it('같은 사람의 동의는 가입마다 따로 쌓인다(이력)', async () => {
    const userId = newUserId();
    await agree(userId);
    await agree(userId, 'one_time');

    const rows = await db
      .select()
      .from(schema.membershipTermsAgreements)
      .where(eq(schema.membershipTermsAgreements.userId, userId));
    expect(rows).toHaveLength(2);
  });

  it('알 수 없는 약관 버전은 적지 않는다', async () => {
    const userId = newUserId();
    await expect(
      manager.record({ userId, termsVersion: '1999-01-01', billingMode: 'recurring', planId }),
    ).rejects.toThrow('알 수 없는 약관 버전');
  });

  it('남의 동의 · 다른 플랜 · 다른 결제 방식의 동의로는 가입할 수 없다', async () => {
    const owner = newUserId();
    const { agreementId } = await agree(owner, 'one_time');

    await expect(manager.resolveForSubscription(newUserId(), agreementId, planId, 'one_time')).rejects.toThrow();
    await expect(manager.resolveForSubscription(owner, agreementId, otherPlanId, 'one_time')).rejects.toThrow();
    // 1회결제 약관엔 제5조(미납 요금)가 없다 — 그 동의로 정기결제에 가입시키지 않는다.
    await expect(manager.resolveForSubscription(owner, agreementId, planId, 'recurring')).rejects.toThrow();
    await expect(manager.resolveForSubscription(owner, agreementId, planId, 'one_time')).resolves.toBe(agreementId);
  });

  it('동의는 가입 하나에만 이어지고, 이어진 뒤에는 다른 가입에 쓸 수 없다', async () => {
    const userId = newUserId();
    const { agreementId } = await agree(userId);
    const first = await newContract(userId);
    const second = await newContract(userId);

    await manager.linkContract(userId, agreementId, first);
    await manager.linkContract(userId, agreementId, second);

    const [row] = await db
      .select()
      .from(schema.membershipTermsAgreements)
      .where(eq(schema.membershipTermsAgreements.id, agreementId));
    expect(row.contractId).toBe(first);
    await expect(manager.resolveForSubscription(userId, agreementId, planId, 'recurring')).rejects.toThrow();
  });

  it('남의 동의에는 이어 붙이지 않는다', async () => {
    const owner = newUserId();
    const { agreementId } = await agree(owner);
    const stranger = newUserId();
    const contractId = await newContract(stranger);

    await manager.linkContract(stranger, agreementId, contractId);

    const [row] = await db
      .select()
      .from(schema.membershipTermsAgreements)
      .where(eq(schema.membershipTermsAgreements.id, agreementId));
    expect(row.contractId).toBeNull();
  });
});
