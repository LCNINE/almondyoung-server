import { drizzle } from 'drizzle-orm/postgres-js';
import { count, sql } from 'drizzle-orm';
import { reviewEligibilities, reviews } from '../../../db/schema';

/**
 * 출처·발급경로 내역은 «같은 스캔»의 filter 집계로 뽑는다 — 왕복을 더하지 않기 위해서다.
 *
 * 그 fragment 는 원시 sql 이라 쿼리의 테이블 수에 따라 컬럼 참조의 한정이 갈린다
 * (`is-best-correlated-subquery.spec.ts` 가 그 규칙을 못박는다). 여기서는 두 가지를 지킨다:
 * 조건이 실제로 SQL 에 실린다는 것과, 조인이 붙어도 컬럼 참조가 모호해지지 않는다는 것.
 */
describe('통계 filter 집계의 생성 SQL', () => {
  const db = drizzle({} as never);
  const OWN = 'almondyoung';

  const ownCount = sql<number>`count(*) filter (where ${reviews.sourceSystem} = ${OWN})::int`;
  const legacyCount = sql<number>`count(*) filter (where ${reviews.sourceSystem} <> ${OWN})::int`;

  it('자체/이관 내역이 하나의 집계 쿼리 안에 filter 절로 실린다', () => {
    const { sql: text } = db
      .select({ reviewCount: count(), ownReviewCount: ownCount, legacyReviewCount: legacyCount })
      .from(reviews)
      .toSQL();

    expect(text).toContain('filter (where');
    expect(text).toContain('source_system');
    // 서브쿼리로 갈라져 스캔이 늘지 않았는지 — from 절은 하나뿐이어야 한다.
    expect(text.match(/ from /gi)?.length).toBe(1);
  });

  it('출처 값은 리터럴로 박히지 않고 파라미터로 나간다', () => {
    const { sql: text, params } = db.select({ ownReviewCount: ownCount }).from(reviews).toSQL();

    expect(params).toContain(OWN);
    expect(text).not.toContain(`'${OWN}'`);
  });

  it('조인이 붙어도 출처 컬럼 참조가 테이블 이름을 잃지 않는다', () => {
    // reviews 와 review_eligibilities 둘 다 source_system 을 갖는다 — 한정이 빠지면 ambiguous 다.
    const { sql: text } = db
      .select({ ownReviewCount: ownCount })
      .from(reviews)
      .innerJoin(reviewEligibilities, sql`${reviewEligibilities.consumedByReviewId} = ${reviews.id}`)
      .toSQL();

    expect(text).toContain('"reviews"."source_system"');
  });
});
