import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, inArray } from 'drizzle-orm';
import type { DbService } from '@app/db';
import {
  reviewBestSelections,
  reviewEligibilities,
  reviewRewardRules,
  reviews,
  ugcServiceSchema,
  type UgcServiceSchema,
} from '../../db/schema';
import { ReviewBestSelectionService, previousWeekRange } from './review-best-selection.service';
import { DEFAULT_REWARD_CONDITIONS, DEFAULT_REWARD_LIMITS } from './reward-rule.types';

/**
 * 주간 베스트 후보에서 «주문 밖 권한으로 쓴 리뷰»가 빠지는지를 실 Postgres 로 검증한다 —
 * 상관 서브쿼리(notExists)는 목으로 확인할 수 없다. 생성되는 SQL 이 실제로 바깥 표를 한정하는지가
 * 관건이라 조인·서브쿼리는 반드시 실 DB 로 태운다. 시드는 2260년 날짜로 격리한다.
 *
 * 실행: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ugc \
 *   npx jest --testPathPattern="review-best-selection.provider-boundary.integration"
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('주간 베스트 후보는 주문에서 나온 권한만 받는다 (실 Postgres)', () => {
  jest.setTimeout(120_000);

  // 지난 주가 2260-08-09 ~ 2260-08-16(KST) 이 되는 시각
  const NOW = new Date('2260-08-18T00:00:00+09:00');
  const period = previousWeekRange(NOW);
  const createdAt = new Date(period.start.getTime() + 24 * 60 * 60 * 1000);

  const RULE_ID = randomUUID();
  const userId = randomUUID();
  const productId = randomUUID();

  const noPermissionReviewId = randomUUID();
  const orderReviewId = randomUUID();
  const adminReviewId = randomUUID();
  const allReviewIds = [noPermissionReviewId, orderReviewId, adminReviewId];

  const orderPermissionId = randomUUID();
  const adminPermissionId = randomUUID();
  const allPermissionIds = [orderPermissionId, adminPermissionId];

  let sql: postgres.Sql;
  let db: ReturnType<typeof drizzle<UgcServiceSchema>>;
  let service: ReviewBestSelectionService;

  const rule = {
    id: RULE_ID,
    priority: 0,
    stopOnMatch: true,
    conditions: {
      ...DEFAULT_REWARD_CONDITIONS,
      best: { mode: 'HELPFUL_COUNT' as const, topN: 10, minHelpfulCount: 0 },
    },
    reward: { kind: 'NONE' as const },
    limits: { ...DEFAULT_REWARD_LIMITS },
    startsAt: null,
    endsAt: null,
    createdAt: new Date('2260-01-01T00:00:00.000Z'),
  };

  beforeAll(async () => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: ugcServiceSchema });
    service = new ReviewBestSelectionService(
      {
        db,
        run: (fn: (trx: unknown) => unknown, tx?: unknown) => (tx ? fn(tx) : db.transaction(fn as never)),
      } as unknown as DbService<UgcServiceSchema>,
      { getActiveRules: async () => [rule] } as never,
      {} as never,
      {} as never,
    );

    // 후보 행의 rule_id FK 를 채우기 위한 규칙. `getActiveRules` 는 목이라 활성 여부는 보지 않지만,
    // 공유 로컬 DB 의 다른 경로가 이 규칙을 집지 않도록 active=false 로 둔다.
    await db.insert(reviewRewardRules).values({
      id: RULE_ID,
      name: 'provider-boundary-itest',
      trigger: 'WEEKLY_BEST',
      active: false,
      priority: rule.priority,
      stopOnMatch: rule.stopOnMatch,
      conditions: rule.conditions,
      reward: rule.reward,
      limits: rule.limits,
    });

    await db.insert(reviewEligibilities).values([
      {
        id: orderPermissionId,
        userId,
        productId,
        orderId: `order-${orderPermissionId}`,
        provider: 'order',
        orderLineId: `line-${orderPermissionId}`,
        expiresAt: new Date('2261-01-01T00:00:00.000Z'),
      },
      {
        id: adminPermissionId,
        userId,
        productId,
        orderId: `order-${adminPermissionId}`,
        provider: 'admin',
        batchId: 'provider-boundary-itest',
        expiresAt: new Date('2261-01-01T00:00:00.000Z'),
      },
    ]);

    await db.insert(reviews).values([
      {
        id: noPermissionReviewId,
        userId,
        productId,
        rating: 5,
        content: '권한 행이 없는 이관·구 데이터 리뷰',
        createdAt,
      },
      {
        id: orderReviewId,
        userId,
        productId,
        rating: 5,
        content: '주문에서 나온 권한으로 쓴 리뷰',
        createdAt,
        reviewPermissionId: orderPermissionId,
      },
      {
        id: adminReviewId,
        userId,
        productId,
        rating: 5,
        content: '운영자가 준 권한으로 쓴 리뷰',
        createdAt,
        reviewPermissionId: adminPermissionId,
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(reviewBestSelections).where(inArray(reviewBestSelections.reviewId, allReviewIds));
    await db.delete(reviews).where(inArray(reviews.id, allReviewIds));
    await db.delete(reviewEligibilities).where(inArray(reviewEligibilities.id, allPermissionIds));
    await db.delete(reviewRewardRules).where(eq(reviewRewardRules.id, RULE_ID));
    await sql.end();
  });

  async function selectedReviewIds(): Promise<Set<string>> {
    await service.generateCandidates(NOW);
    const rows = await db
      .select({ reviewId: reviewBestSelections.reviewId })
      .from(reviewBestSelections)
      .where(inArray(reviewBestSelections.reviewId, allReviewIds));
    return new Set(rows.map((row) => row.reviewId));
  }

  it("provider 가 'admin' 인 권한으로 쓴 리뷰는 후보에서 빠진다", async () => {
    expect((await selectedReviewIds()).has(adminReviewId)).toBe(false);
  });

  it("provider 가 'order' 인 권한으로 쓴 리뷰는 이전과 같이 후보가 된다", async () => {
    expect((await selectedReviewIds()).has(orderReviewId)).toBe(true);
  });

  it('권한 행이 없는 기존·이관 리뷰는 동작이 바뀌지 않고 후보로 남는다', async () => {
    expect((await selectedReviewIds()).has(noPermissionReviewId)).toBe(true);
  });
});
