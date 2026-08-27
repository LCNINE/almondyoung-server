import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { inArray } from 'drizzle-orm';
import type { DbService } from '@app/db';
import { reviews, ugcServiceSchema, type UgcServiceSchema } from '../../db/schema';
import { ReviewStatisticsService } from './review-statistics.service';

/**
 * 리뷰 통계의 저평점·리뷰많은상품 페이지네이션을 실 Postgres 로 검증한다 —
 * having 서브쿼리 count 와 offset 은 목으로 확인할 수 없다. 시드는 2260년 날짜로 격리한다.
 *
 * 실행: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ugc \
 *   npx jest --testPathPattern="review-statistics.service.integration"
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('ReviewStatisticsService 페이지네이션 (실 Postgres)', () => {
  jest.setTimeout(120_000);

  // 시드 기간 — 다른 데이터와 겹치지 않는 먼 미래
  const FROM = '2260-08-01';
  const TO = '2260-08-31';
  const productA = randomUUID(); // 저평점 (평균 2.0, 3건)
  const productB = randomUUID(); // 저평점 (평균 3.0, 3건)
  const productC = randomUUID(); // 정상 (평균 5.0, 4건) — topProducts 1위
  const allProducts = [productA, productB, productC];

  let sql: postgres.Sql;
  let db: ReturnType<typeof drizzle<UgcServiceSchema>>;
  let service: ReviewStatisticsService;

  const reviewRow = (productId: string, rating: number, day: number) => ({
    productId,
    rating,
    content: `통합테스트 리뷰 ${rating}점`,
    status: 'active' as const,
    createdAt: new Date(`2260-08-${String(day).padStart(2, '0')}T10:00:00+09:00`),
  });

  beforeAll(async () => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: ugcServiceSchema });
    service = new ReviewStatisticsService({ db } as unknown as DbService<UgcServiceSchema>);

    await db.insert(reviews).values([
      reviewRow(productA, 1, 2),
      reviewRow(productA, 2, 3),
      reviewRow(productA, 3, 4),
      reviewRow(productB, 3, 2),
      reviewRow(productB, 3, 3),
      reviewRow(productB, 3, 4),
      reviewRow(productC, 5, 2),
      reviewRow(productC, 5, 3),
      reviewRow(productC, 5, 4),
      reviewRow(productC, 5, 5),
    ]);
  });

  afterAll(async () => {
    await db.delete(reviews).where(inArray(reviews.productId, allProducts));
    await sql.end();
  });

  it('저평점 목록 — limit=1 페이지 걷기가 평균 오름차순으로 전 상품을 한 번씩 낸다', async () => {
    const page1 = await service.getStatistics(FROM, TO, 1, 1, 1);
    const page2 = await service.getStatistics(FROM, TO, 1, 2, 1);
    const page3 = await service.getStatistics(FROM, TO, 1, 3, 1);

    expect(page1.lowRatedTotalItems).toBe(2);
    expect(page1.lowRated.map((row) => row.productId)).toEqual([productA]);
    expect(page2.lowRated.map((row) => row.productId)).toEqual([productB]);
    expect(page3.lowRated).toEqual([]);
    expect(page1.lowRatedPage).toBe(1);
    expect(page1.limit).toBe(1);
  });

  it('리뷰많은상품 목록 — 독립 페이지로 걷고 총건수는 상품 수와 같다', async () => {
    const page1 = await service.getStatistics(FROM, TO, 1, 1, 1);
    const page2 = await service.getStatistics(FROM, TO, 1, 1, 2);

    expect(page1.topProductsTotalItems).toBe(3);
    expect(page1.topProducts.map((row) => row.productId)).toEqual([productC]);
    // 2·3위는 리뷰 3건 동수 — 2차 정렬(평균 평점 내림차순)로 B(3.0)가 A(2.0)보다 앞선다
    expect(page2.topProducts.map((row) => row.productId)).toEqual([productB]);
    expect(page2.topProductsPage).toBe(2);
    // lowRated 는 topProductsPage 와 무관하게 1페이지 그대로
    expect(page2.lowRated.map((row) => row.productId)).toEqual([productA]);
  });

  it('페이지 인자를 생략하면 기존 응답과 같은 1페이지를 낸다', async () => {
    const result = await service.getStatistics(FROM, TO, 10);
    expect(result.lowRated.map((row) => row.productId)).toEqual([productA, productB]);
    expect(result.topProducts[0].productId).toBe(productC);
    expect(result.totals.reviewCount).toBe(10);
  });
});
