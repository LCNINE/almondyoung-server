import { Injectable } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { and, count, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { reactions, reviewComments, reviewEligibilities, reviewMedia, reviews, type UgcServiceSchema } from '../../db/schema';
import {
  AdminReviewStatisticsResponseDto,
  BestReviewDto,
  ProductRatingRowDto,
  RatingBucketDto,
} from '../dto/review-statistics.dto';

/** KST 달력 날짜(YYYY-MM-DD)의 자정을 UTC instant 로 — created_at 은 UTC instant 로 저장된다. */
export function kstDayStartUtc(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00+09:00`);
}

/** 날짜 문자열 산술은 KST 오프셋과 무관하다 — 달력 날짜끼리의 덧뺄셈은 UTC 기준으로 해도 같다. */
export function addDays(dateOnly: string, days: number): string {
  const base = new Date(`${dateOnly}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/** 직전 동일 길이 기간 — [from-len, from-1] */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const lengthDays =
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  return { from: addDays(from, -lengthDays), to: addDays(from, -1) };
}

/** 없는 점수를 0 으로 채워 1~5 전부 내려보낸다 — 화면이 빈 칸을 추측하지 않게. */
export function fillRatingDistribution(rows: { rating: number; count: number }[]): RatingBucketDto[] {
  const byRating = new Map(rows.map((row) => [row.rating, row.count]));
  return [5, 4, 3, 2, 1].map((rating) => ({ rating, count: byRating.get(rating) ?? 0 }));
}

export function toExcerpt(content: string, maxLength = 200): string {
  return content.length > maxLength ? `${content.slice(0, maxLength)}…` : content;
}

/** 저평점 경보 — 이 평균 아래로 떨어진 상품을 골라낸다. */
const LOW_RATED_THRESHOLD = 3.5;
/** 리뷰 1~2건짜리 노이즈가 경보를 덮지 않게 하는 최소 리뷰 수. */
const LOW_RATED_MIN_REVIEWS = 3;
const BEST_REVIEWS_LIMIT = 5;

@Injectable()
export class ReviewStatisticsService {
  constructor(@InjectDb() private readonly db: DbService<UgcServiceSchema>) {}

  private get client() {
    return this.db.db;
  }

  async getStatistics(from: string, to: string, limit: number): Promise<AdminReviewStatisticsResponseDto> {
    const prev = previousRange(from, to);
    const fromTs = kstDayStartUtc(from);
    const toExclusiveTs = kstDayStartUtc(addDays(to, 1));
    const prevFromTs = kstDayStartUtc(prev.from);
    const prevToExclusiveTs = kstDayStartUtc(addDays(prev.to, 1));

    const periodWhere = (start: Date, endExclusive: Date) =>
      and(
        eq(reviews.status, 'active'),
        isNull(reviews.deletedAt),
        gte(reviews.createdAt, start),
        lt(reviews.createdAt, endExclusive),
      );
    const base = periodWhere(fromTs, toExclusiveTs);

    const averageRatingExpr = sql<number | null>`avg(${reviews.rating})::float`;
    // created_at 은 UTC naive — 먼저 UTC 로 못박은 뒤 KST 로 옮겨야 달력 날짜가 맞다.
    const kstBucketExpr = sql<string>`to_char((${reviews.createdAt} at time zone 'UTC') at time zone 'Asia/Seoul', 'YYYY-MM-DD')`;

    const [
      [totals],
      [previousTotals],
      distributionRows,
      seriesRows,
      lowRatedRows,
      topProductRows,
      bestReviewRows,
      [photoTotals],
      [commentTotals],
      [eligibility],
    ] = await Promise.all([
      this.client.select({ reviewCount: count(), averageRating: averageRatingExpr }).from(reviews).where(base),
      this.client
        .select({ reviewCount: count(), averageRating: averageRatingExpr })
        .from(reviews)
        .where(periodWhere(prevFromTs, prevToExclusiveTs)),
      this.client
        .select({ rating: reviews.rating, count: count() })
        .from(reviews)
        .where(base)
        .groupBy(reviews.rating),
      this.client
        .select({ bucket: kstBucketExpr, count: count(), averageRating: averageRatingExpr })
        .from(reviews)
        .where(base)
        .groupBy(kstBucketExpr)
        .orderBy(kstBucketExpr),
      this.client
        .select({ productId: reviews.productId, reviewCount: count(), averageRating: averageRatingExpr })
        .from(reviews)
        .where(base)
        .groupBy(reviews.productId)
        .having(
          sql`count(*) >= ${LOW_RATED_MIN_REVIEWS} and avg(${reviews.rating}) < ${LOW_RATED_THRESHOLD}`,
        )
        .orderBy(sql`avg(${reviews.rating}) asc`, desc(count()))
        .limit(limit),
      this.client
        .select({ productId: reviews.productId, reviewCount: count(), averageRating: averageRatingExpr })
        .from(reviews)
        .where(base)
        .groupBy(reviews.productId)
        .orderBy(desc(count()), sql`avg(${reviews.rating}) desc`)
        .limit(limit),
      this.client
        .select({
          reviewId: reviews.id,
          productId: reviews.productId,
          rating: reviews.rating,
          content: reviews.content,
          createdAt: reviews.createdAt,
          reactionCount: count(reactions.userId),
          hasPhoto: sql<boolean>`exists (select 1 from ${reviewMedia} where ${reviewMedia.reviewId} = ${reviews.id})`,
        })
        .from(reviews)
        .innerJoin(reactions, and(eq(reactions.targetType, 'review'), eq(reactions.targetId, reviews.id)))
        .where(base)
        .groupBy(reviews.id)
        .orderBy(desc(count(reactions.userId)), desc(reviews.createdAt))
        .limit(BEST_REVIEWS_LIMIT),
      this.client
        .select({ count: sql<number>`count(distinct ${reviewMedia.reviewId})::int` })
        .from(reviewMedia)
        .innerJoin(reviews, eq(reviewMedia.reviewId, reviews.id))
        .where(base),
      // review_comments 는 리뷰당 1건 unique — 조인 행 수가 곧 응대된 리뷰 수다.
      this.client
        .select({ count: count() })
        .from(reviewComments)
        .innerJoin(reviews, eq(reviewComments.reviewId, reviews.id))
        .where(base),
      this.client
        .select({
          eligibleCount: count(),
          consumedCount: sql<number>`count(*) filter (where ${reviewEligibilities.consumedAt} is not null)::int`,
        })
        .from(reviewEligibilities)
        .where(and(gte(reviewEligibilities.eligibleAt, fromTs), lt(reviewEligibilities.eligibleAt, toExclusiveTs))),
    ]);

    const toProductRow = (row: { productId: string; reviewCount: number; averageRating: number | null }): ProductRatingRowDto => ({
      productId: row.productId,
      reviewCount: row.reviewCount,
      averageRating: row.averageRating ?? 0,
    });

    const bestReviews: BestReviewDto[] = bestReviewRows.map((row) => ({
      reviewId: row.reviewId,
      productId: row.productId,
      rating: row.rating,
      contentExcerpt: toExcerpt(row.content),
      reactionCount: row.reactionCount,
      hasPhoto: row.hasPhoto,
      createdAt: row.createdAt.toISOString(),
    }));

    return {
      range: { from, to },
      previousRange: prev,
      totals: {
        reviewCount: totals?.reviewCount ?? 0,
        previousReviewCount: previousTotals?.reviewCount ?? 0,
        averageRating: totals?.averageRating ?? null,
        previousAverageRating: previousTotals?.averageRating ?? null,
        photoReviewCount: photoTotals?.count ?? 0,
        adminCommentedCount: commentTotals?.count ?? 0,
        eligibleCount: eligibility?.eligibleCount ?? 0,
        consumedEligibleCount: eligibility?.consumedCount ?? 0,
      },
      ratingDistribution: fillRatingDistribution(distributionRows),
      series: seriesRows,
      lowRated: lowRatedRows.map(toProductRow),
      topProducts: topProductRows.map(toProductRow),
      bestReviews,
    };
  }
}
