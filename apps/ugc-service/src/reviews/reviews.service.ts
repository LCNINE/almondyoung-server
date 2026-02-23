import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { and, asc, count, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { reviewMedia, reviews, reviewHelpfuls, type UgcServiceSchema } from '../db/schema';
import { CreateReviewDto } from './dto/create-review.dto';
import { ReviewListQueryDto } from './dto/review-list-query.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { type ReviewEntity, type ReviewWithMediaEntity } from './types';
import { PaginatedResponseDto } from '@app/shared/dto';
import { MAX_REVIEW_MEDIA_COUNT } from './constants';

const SOURCE_SYSTEM = 'almondyoung';

type DbTransaction = Parameters<
  Parameters<DbService<UgcServiceSchema>['db']['transaction']>[0]
>[0];

@Injectable()
export class ReviewsService {
  constructor(@InjectDb() private readonly db: DbService<UgcServiceSchema>) { }

  private get client() {
    return this.db.db;
  }

  private async inTx<T>(
    fn: (tx: DbTransaction) => Promise<T>,
    tx?: DbTransaction,
  ): Promise<T> {
    return tx ? fn(tx) : this.client.transaction(fn);
  }

  private normalizeMediaFileIds(mediaFileIds?: string[] | null): string[] {
    if (!mediaFileIds) {
      return [];
    }

    if (mediaFileIds.length > MAX_REVIEW_MEDIA_COUNT) {
      throw new BadRequestException(
        `Media files can be attached up to ${MAX_REVIEW_MEDIA_COUNT}`,
      );
    }

    const uniqueMedia = new Set(mediaFileIds);
    if (uniqueMedia.size !== mediaFileIds.length) {
      throw new BadRequestException('Duplicate media files are not allowed');
    }

    return mediaFileIds;
  }

  private async insertReviewMedia(
    reviewId: string,
    mediaFileIds: string[],
    tx: DbTransaction,
  ): Promise<void> {
    if (mediaFileIds.length === 0) {
      return;
    }

    await tx.insert(reviewMedia).values(
      mediaFileIds.map((fileId, index) => ({
        reviewId,
        fileId,
        order: index,
      })),
    );
  }

  private async fetchMediaFileIdsByReviewIds(
    reviewIds: string[],
    tx: DbTransaction,
  ): Promise<Map<string, string[]>> {
    if (reviewIds.length === 0) {
      return new Map();
    }

    const rows = await tx
      .select({
        reviewId: reviewMedia.reviewId,
        fileId: reviewMedia.fileId,
        order: reviewMedia.order,
      })
      .from(reviewMedia)
      .where(inArray(reviewMedia.reviewId, reviewIds))
      .orderBy(reviewMedia.reviewId, reviewMedia.order);

    const mediaMap = new Map<string, string[]>();
    for (const row of rows) {
      const list = mediaMap.get(row.reviewId);
      if (list) {
        list.push(row.fileId);
      } else {
        mediaMap.set(row.reviewId, [row.fileId]);
      }
    }

    return mediaMap;
  }

  private async fetchMediaFileIdsByReviewId(
    reviewId: string,
    tx: DbTransaction,
  ): Promise<string[]> {
    const mediaMap = await this.fetchMediaFileIdsByReviewIds([reviewId], tx);
    return mediaMap.get(reviewId) ?? [];
  }

  private async fetchHelpfulCounts(
    reviewIds: string[],
    tx: DbTransaction,
  ): Promise<Map<string, number>> {
    if (reviewIds.length === 0) {
      return new Map();
    }

    const rows = await tx
      .select({
        reviewId: reviewHelpfuls.reviewId,
        count: count(),
      })
      .from(reviewHelpfuls)
      .where(inArray(reviewHelpfuls.reviewId, reviewIds))
      .groupBy(reviewHelpfuls.reviewId);

    const countMap = new Map<string, number>();
    for (const row of rows) {
      countMap.set(row.reviewId, row.count);
    }

    return countMap;
  }

  async toggleHelpful(
    userId: string,
    reviewId: string,
    tx?: DbTransaction,
  ): Promise<{ marked: boolean; helpfulCount: number }> {
    return this.inTx(async (tx) => {
      // 리뷰 존재 확인
      const [review] = await tx
        .select({ id: reviews.id })
        .from(reviews)
        .where(and(eq(reviews.id, reviewId), eq(reviews.status, 'active')));

      if (!review) {
        throw new NotFoundException('Review not found');
      }

      // 기존 helpful 여부 확인
      const [existing] = await tx
        .select({ reviewId: reviewHelpfuls.reviewId })
        .from(reviewHelpfuls)
        .where(
          and(
            eq(reviewHelpfuls.reviewId, reviewId),
            eq(reviewHelpfuls.userId, userId),
          ),
        );

      let marked: boolean;

      if (existing) {
        // 이미 있으면 삭제
        await tx
          .delete(reviewHelpfuls)
          .where(
            and(
              eq(reviewHelpfuls.reviewId, reviewId),
              eq(reviewHelpfuls.userId, userId),
            ),
          );
        marked = false;
      } else {
        // 없으면 추가
        await tx.insert(reviewHelpfuls).values({
          reviewId,
          userId,
        });
        marked = true;
      }

      // 현재 helpful 카운트 조회
      const [countResult] = await tx
        .select({ count: count() })
        .from(reviewHelpfuls)
        .where(eq(reviewHelpfuls.reviewId, reviewId));

      return {
        marked,
        helpfulCount: countResult.count,
      };
    }, tx);
  }

  async create(
    userId: string,
    dto: CreateReviewDto,
    tx?: DbTransaction,
  ): Promise<ReviewWithMediaEntity> {
    return this.inTx(async (tx) => {
      const mediaFileIds = this.normalizeMediaFileIds(dto.mediaFileIds);
      const [review] = await tx
        .insert(reviews)
        .values({
          userId,
          productId: dto.productId,
          rating: dto.rating,
          content: dto.content,
          sourceSystem: SOURCE_SYSTEM,
        })
        .returning();

      await this.insertReviewMedia(review.id, mediaFileIds, tx);

      return {
        ...review,
        mediaFileIds,
        helpfulCount: 0,
      };
    }, tx);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateReviewDto,
    tx?: DbTransaction,
  ): Promise<ReviewWithMediaEntity> {
    return this.inTx(async (tx) => {
      const hasMediaUpdate = dto.mediaFileIds !== undefined;
      const mediaFileIds = this.normalizeMediaFileIds(dto.mediaFileIds);

      const updateData: Partial<ReviewEntity> = {
        updatedAt: new Date(),
      };

      if (dto.rating !== undefined) {
        updateData.rating = dto.rating;
      }

      if (dto.content !== undefined) {
        updateData.content = dto.content;
      }

      const hasReviewUpdate = Object.keys(updateData).length > 1;

      if (!hasReviewUpdate && !hasMediaUpdate) {
        throw new BadRequestException('No fields to update');
      }

      const [review] = await tx
        .update(reviews)
        .set(updateData)
        .where(
          and(
            eq(reviews.id, id),
            eq(reviews.userId, userId),
            eq(reviews.sourceSystem, SOURCE_SYSTEM),
          ),
        )
        .returning();

      if (!review) {
        throw new NotFoundException('Review not found');
      }

      if (hasMediaUpdate) {
        await tx.delete(reviewMedia).where(eq(reviewMedia.reviewId, id));
        await this.insertReviewMedia(id, mediaFileIds, tx);
      }

      const resolvedMediaFileIds = hasMediaUpdate
        ? mediaFileIds
        : await this.fetchMediaFileIdsByReviewId(id, tx);

      const helpfulCountMap = await this.fetchHelpfulCounts([id], tx);

      return {
        ...review,
        mediaFileIds: resolvedMediaFileIds,
        helpfulCount: helpfulCountMap.get(id) ?? 0,
      };
    }, tx);
  }

  async remove(userId: string, id: string, tx?: DbTransaction): Promise<void> {
    return this.inTx(async (tx) => {
      const [review] = await tx
        .update(reviews)
        .set({
          status: 'deleted',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(reviews.id, id),
            eq(reviews.userId, userId),
            eq(reviews.sourceSystem, SOURCE_SYSTEM),
          ),
        )
        .returning({ id: reviews.id });

      if (!review) {
        throw new NotFoundException('Review not found');
      }
    }, tx);
  }

  async listByProduct(
    query: ReviewListQueryDto,
    tx?: DbTransaction,
  ): Promise<PaginatedResponseDto<ReviewWithMediaEntity>> {
    return this.inTx(async (tx) => {
      const page = query.page ?? 1;
      const limit = query.limit ?? 20;
      const offset = (page - 1) * limit;

      const conditions: SQL[] = [
        eq(reviews.productId, query.productId),
        eq(reviews.status, 'active'),
      ];

      if (query.rating) {
        if (query.rating === 'positive') {
          conditions.push(inArray(reviews.rating, [4, 5]));
        } else if (query.rating === 'negative') {
          conditions.push(inArray(reviews.rating, [1, 2]));
        } else {
          conditions.push(eq(reviews.rating, Number(query.rating)));
        }
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const countQuery = tx.select({ count: count() }).from(reviews);
      if (whereClause) {
        countQuery.where(whereClause);
      }

      const [{ count: total }] = await countQuery;

      const orderByClause = {
        latest: desc(reviews.createdAt),
        oldest: asc(reviews.createdAt),
        rating_high: desc(reviews.rating),
        rating_low: asc(reviews.rating),
      }[query.sort ?? 'latest'];

      const dataQuery = tx
        .select()
        .from(reviews)
        .orderBy(orderByClause)
        .limit(limit)
        .offset(offset);

      if (whereClause) {
        dataQuery.where(whereClause);
      }

      const data = await dataQuery;

      const reviewIds = data.map((review) => review.id);

      const mediaMap = await this.fetchMediaFileIdsByReviewIds(reviewIds, tx);
      const helpfulCountMap = await this.fetchHelpfulCounts(reviewIds, tx);

      return {
        data: data.map((review) => ({
          ...review,
          mediaFileIds: mediaMap.get(review.id) ?? [],
          helpfulCount: helpfulCountMap.get(review.id) ?? 0,
        })),
        total,
        page,
        limit,
      };
    }, tx);
  }
}
