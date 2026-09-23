/**
 * 「멤버십 혜택을 썼는가」의 원천 조회 — 실제 Postgres 통합.
 *
 * 웰컴딜 표는 `user_id` 가 uuid 칸이라 목으로는 형 변환 오류를 재현할 수 없다.
 * DATABASE_URL 이 없으면 통째로 skip 된다 — `npx jest` 기본 게이트에서는 돌지 않는다.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- postgres publishes `export =`; Jest compiles CJS.
import postgres = require('postgres');
import { randomUUID } from 'crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { BenefitReader } from './benefit.reader';
import { hasUsedMembershipBenefit } from './benefit-usage';
import * as schema from '../../shared/schemas/entities/schema';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('BenefitReader.findMembershipBenefitUsageSince (PostgreSQL 통합)', () => {
  jest.setTimeout(60_000);

  let client: ReturnType<typeof postgres>;
  let reader: BenefitReader;
  const userIds: string[] = [];

  const since = new Date('2026-09-10T00:00:00Z');

  async function welcome(userId: string, purchasedAt: Date | null, hasPurchased = true) {
    userIds.push(userId);
    await drizzle(client).insert(schema.welcomeMembershipEligibility).values({
      userId,
      hasPurchased,
      purchaseSource: 'medusa',
      purchasedAt,
    });
  }

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 2, prepare: false });
    reader = new BenefitReader({ db: drizzle(client) } as never);
  });

  afterAll(async () => {
    try {
      if (userIds.length > 0) {
        await client`delete from welcome_membership_eligibility where user_id = any(${client.array(userIds)}::uuid[])`;
      }
    } finally {
      await client.end({ timeout: 5 });
    }
  });

  it('기간 안에 웰컴딜을 샀으면 할인이 0원이어도 혜택 사용이다', async () => {
    const userId = randomUUID();
    await welcome(userId, new Date('2026-09-12T00:00:00Z'));

    const usage = await reader.findMembershipBenefitUsageSince(userId, since);
    expect(usage).toMatchObject({ totalDiscountAmount: 0, welcomeDeal: true });
    expect(hasUsedMembershipBenefit(usage)).toBe(true);
  });

  it('기간 전에 산 웰컴딜은 이번 주기의 사용이 아니다', async () => {
    const userId = randomUUID();
    await welcome(userId, new Date('2026-09-01T00:00:00Z'));

    const usage = await reader.findMembershipBenefitUsageSince(userId, since);
    expect(usage.welcomeDeal).toBe(false);
  });

  it('구매가 취소돼 기록이 지워졌으면 사용이 아니다', async () => {
    const userId = randomUUID();
    await welcome(userId, null, false);

    const usage = await reader.findMembershipBenefitUsageSince(userId, since);
    expect(usage.welcomeDeal).toBe(false);
  });

  it('uuid 가 아닌 사용자 id 로도 오류 없이 답한다 — 해지 화면이 같이 죽지 않게', async () => {
    await expect(reader.findMembershipBenefitUsageSince('legacy-user-1', since)).resolves.toMatchObject({
      welcomeDeal: false,
    });
  });
});
