import { drizzle } from 'drizzle-orm/postgres-js';
import { and, count, eq, exists, sql } from 'drizzle-orm';
import { reactions, reviewBestSelections, reviewMedia, reviews } from '../../../db/schema';

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

  /**
   * 원시 sql 템플릿이 한정을 잃는 조건은 「원시 sql 이냐」가 아니라 «쿼리에 테이블이 몇 개냐 +
   * fragment 가 어디에 놓였냐» 다. 아래 두 케이스가 그 사실을 못박는다 — 조인이 있으면 원시 sql
   * 도 한정되고, 단일 테이블이면 같은 fragment 가 select 목록에서만 한정을 잃는다.
   * 이 조건부에 기대지 않기 위해 상관 서브쿼리는 전부 빌더로 짠다.
   */
  it('원시 sql 템플릿은 단일 테이블 쿼리의 select 목록에서 한정을 잃는다', () => {
    const rawHelpful = sql<number>`(
      select count(*) from ${reactions}
      where ${reactions.targetId} = ${reviews.id}
    )`;

    const { sql: text } = db
      .select({ helpfulCount: rawHelpful.as('helpful_count') })
      .from(reviews)
      .toSQL();

    expect(text).toContain('"target_id" = "id"');
  });

  it('빌더로 짠 상관 서브쿼리는 단일 테이블 쿼리에서도 select 목록·where 양쪽에서 한정된다', () => {
    const helpfulCount = sql<number>`(${db
      .select({ value: count() })
      .from(reactions)
      .where(and(eq(reactions.targetType, 'review'), eq(reactions.targetId, reviews.id)))})`;
    const mediaCount = sql<number>`(${db
      .select({ value: count() })
      .from(reviewMedia)
      .where(eq(reviewMedia.reviewId, reviews.id))})`;

    const { sql: text } = db
      .select({ helpfulCount: helpfulCount.as('helpful_count') })
      .from(reviews)
      .where(sql`${mediaCount} >= 1`)
      .toSQL();

    expect(text).toContain('"reactions"."target_id" = "reviews"."id"');
    expect(text).toContain('"review_media"."review_id" = "reviews"."id"');
    expect(text).not.toContain('"target_id" = "id"');
    expect(text).not.toContain('"review_id" = "id"');
  });
});
