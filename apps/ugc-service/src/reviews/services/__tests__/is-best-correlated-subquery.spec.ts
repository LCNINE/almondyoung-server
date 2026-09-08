import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq, exists, sql } from 'drizzle-orm';
import { reviewBestSelections, reviews } from '../../../db/schema';

/**
 * 베스트 뱃지는 리뷰 목록 쿼리 안의 «상관 서브쿼리» 하나로 판정한다.
 *
 * 원시 sql 템플릿으로 짜면 바깥 테이블의 컬럼 참조에 테이블 이름이 안 붙어 `"id"` 로만
 * 나간다. review_best_selections 에도 id 컬럼이 있어 안쪽이 그걸 가려 버리고,
 * 조건은 «자기 자신의 review_id = 자기 자신의 id» 가 되어 항상 거짓이 된다 —
 * 확정된 베스트가 어디에도 안 뜨는데 SQL 오류는 안 난다.
 */
describe('베스트 판정 상관 서브쿼리', () => {
  // SQL 문자열만 본다 — 접속은 하지 않으므로 드라이버 자리는 비워 둔다.
  const db = drizzle({} as never);

  const isBest = exists(
    db
      .select({ _: sql`1` })
      .from(reviewBestSelections)
      .where(and(eq(reviewBestSelections.reviewId, reviews.id), eq(reviewBestSelections.status, 'CONFIRMED'))),
  );

  it('바깥 리뷰 id 를 테이블 이름까지 붙여 참조한다', () => {
    const { sql: text } = db.select({ review: reviews, isBest }).from(reviews).toSQL();

    expect(text).toContain('"review_best_selections"."review_id" = "reviews"."id"');
  });

  it('테이블 이름 없는 컬럼 참조를 남기지 않는다', () => {
    const { sql: text } = db.select({ review: reviews, isBest }).from(reviews).toSQL();
    const subquery = text.slice(text.indexOf('exists ('));

    expect(subquery).not.toContain('"review_id" = "id"');
  });
});
