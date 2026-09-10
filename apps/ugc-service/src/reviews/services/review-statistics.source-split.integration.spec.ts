import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { inArray } from 'drizzle-orm';
import type { DbService } from '@app/db';
import { reviewEligibilities, reviews, ugcServiceSchema, type UgcServiceSchema } from '../../db/schema';
import { ReviewPermissionService } from '../../review-permissions/review-permission.service';
import { ReviewStatisticsService } from './review-statistics.service';

/**
 * 관리자 리뷰 통계가 «이관분»과 «자체 작성분»을 갈라 낸다.
 *
 * 라이브 리뷰 53,716건은 전부 이관분(smartstore·almondyoung-legacy)이고 자체 작성은 0건이다.
 * 합계 하나만 주면 관리자는 「리뷰가 5만 건 있다」를 우리 고객이 쓴 리뷰로 읽는다.
 * 같은 이유로 자격은 `provider` 로 갈라야 한다 — 운영자가 직접 준 권한이 구매 전환율을 밀어 올린다.
 *
 * 실행: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ugc \
 *   npx jest --testPathPattern="review-statistics.source-split"
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('리뷰 통계의 출처·발급경로 분리 (실 Postgres)', () => {
  jest.setTimeout(120_000);

  // 다른 데이터와 겹치지 않는 먼 미래 — 기간 창으로 격리한다.
  const FROM = '2261-08-01';
  const TO = '2261-08-31';
  const mixedProduct = randomUUID();
  const legacyOnlyProduct = randomUUID();
  const allProducts = [mixedProduct, legacyOnlyProduct];
  const eligibilityUser = randomUUID();
  const eligibilityIds: string[] = [];

  let sql: postgres.Sql;
  let db: ReturnType<typeof drizzle<UgcServiceSchema>>;
  let statistics: ReviewStatisticsService;
  let permissions: ReviewPermissionService;

  const at = (day: number) => new Date(`2261-08-${String(day).padStart(2, '0')}T10:00:00+09:00`);

  const reviewRow = (productId: string, rating: number, day: number, sourceSystem: string) => ({
    productId,
    rating,
    content: `출처 분리 테스트 ${sourceSystem} ${rating}점`,
    status: 'active' as const,
    sourceSystem,
    createdAt: at(day),
  });

  beforeAll(async () => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: ugcServiceSchema });
    const dbService = { db, run: (fn: (trx: unknown) => unknown) => fn(db) } as unknown as DbService<UgcServiceSchema>;
    permissions = new ReviewPermissionService(dbService);
    statistics = new ReviewStatisticsService(dbService, permissions);

    await db.insert(reviews).values([
      // 자체 작성 2건 — 평균 4.0
      reviewRow(mixedProduct, 5, 2, 'almondyoung'),
      reviewRow(mixedProduct, 3, 3, 'almondyoung'),
      // 이관 3건 — 평균 5.0
      reviewRow(mixedProduct, 5, 4, 'smartstore'),
      reviewRow(legacyOnlyProduct, 5, 5, 'smartstore'),
      reviewRow(legacyOnlyProduct, 5, 6, 'almondyoung-legacy'),
    ]);

    const inserted = await db
      .insert(reviewEligibilities)
      .values([
        // 주문 발급 2건 (1건 소비)
        {
          userId: eligibilityUser,
          productId: mixedProduct,
          orderId: `src-split-order-${randomUUID()}`,
          provider: 'order' as const,
          eligibleAt: at(2),
          expiresAt: at(28),
          consumedAt: at(3),
        },
        {
          userId: eligibilityUser,
          productId: mixedProduct,
          orderId: `src-split-order-${randomUUID()}`,
          provider: 'order' as const,
          eligibleAt: at(4),
          expiresAt: at(28),
        },
        // 운영자 지급 3건 (전부 미소비)
        ...[5, 6, 7].map((day) => ({
          userId: eligibilityUser,
          productId: legacyOnlyProduct,
          orderId: `src-split-admin-${randomUUID()}`,
          provider: 'admin' as const,
          grantedReason: '출처 분리 테스트',
          eligibleAt: at(day),
          expiresAt: at(28),
        })),
      ])
      .returning({ id: reviewEligibilities.id });
    eligibilityIds.push(...inserted.map((row) => row.id));
  });

  afterAll(async () => {
    await db.delete(reviewEligibilities).where(inArray(reviewEligibilities.id, eligibilityIds));
    await db.delete(reviews).where(inArray(reviews.productId, allProducts));
    await sql.end();
  });

  it('리뷰 수를 합계와 «자체/이관» 내역으로 함께 낸다', async () => {
    const { totals } = await statistics.getStatistics(FROM, TO, 10);

    expect(totals.reviewCount).toBe(5);
    expect(totals.ownReviewCount).toBe(2);
    expect(totals.legacyReviewCount).toBe(3);
    // 두 내역의 합이 합계와 같아야 한다 — 어느 출처도 어느 칸에도 안 들어가는 일이 없어야 한다.
    expect(totals.ownReviewCount + totals.legacyReviewCount).toBe(totals.reviewCount);
  });

  it('평균 평점도 출처별로 갈린다 — 전체 평균이 이관분에 끌려간 값임이 드러난다', async () => {
    const { totals } = await statistics.getStatistics(FROM, TO, 10);

    expect(totals.averageRating).toBeCloseTo(4.6, 5);
    expect(totals.ownAverageRating).toBeCloseTo(4.0, 5);
    expect(totals.legacyAverageRating).toBeCloseTo(5.0, 5);
  });

  it('자체 리뷰가 없는 기간의 자체 평균은 0 이 아니라 null 이다', async () => {
    // 이관분만 있는 하루로 창을 좁힌다 — 「아직 없다」와 「0점이다」는 다른 사실이다.
    const { totals } = await statistics.getStatistics('2261-08-05', '2261-08-06', 10);

    expect(totals.ownReviewCount).toBe(0);
    expect(totals.ownAverageRating).toBeNull();
    expect(totals.legacyAverageRating).toBeCloseTo(5.0, 5);
  });

  it('자격 수를 발급 경로(order/admin)별로 갈라 낸다', async () => {
    const { totals } = await statistics.getStatistics(FROM, TO, 10);

    expect(totals.eligibleCount).toBe(5);
    expect(totals.consumedEligibleCount).toBe(1);
    expect(totals.orderEligibleCount).toBe(2);
    expect(totals.orderConsumedEligibleCount).toBe(1);
    expect(totals.adminEligibleCount).toBe(3);
    expect(totals.adminConsumedEligibleCount).toBe(0);
    expect(totals.orderEligibleCount + totals.adminEligibleCount).toBe(totals.eligibleCount);
  });
});
