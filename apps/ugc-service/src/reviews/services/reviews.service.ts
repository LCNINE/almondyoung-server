import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DbService, InjectDb } from '@app/db';
import { and, asc, count, desc, eq, exists, gte, inArray, isNotNull, isNull, notExists, sql, type SQL } from 'drizzle-orm';
import {
  reviewComments,
  reviewEligibilities,
  reviewMedia,
  reviews,
  reactions,
  type UgcServiceSchema,
} from '../../db/schema';
import { CreateReviewDto } from '../dto/create-review.dto';
import { CreateCommentDto } from '../dto/create-comment.dto';
import { MyReviewListQueryDto } from '../dto/my-review-list-query.dto';
import { AdminReviewListQueryDto, ReviewListQueryDto } from '../dto/review-list-query.dto';
import { UpdateReviewDto } from '../dto/update-review.dto';
import { type ReviewCommentEntity, type ReviewEntity, type ReviewStatus, type ReviewWithMediaEntity } from '../types';
import { PaginatedResponseDto } from '@app/shared/dto';
import { MAX_REVIEW_MEDIA_COUNT } from '../constants';
import { ReviewRewardPolicyService } from './review-reward-policy.service';
import { ReviewRewardPublisher } from './review-reward-publisher.service';
import { ReviewStatsPublisher } from './review-stats-publisher.service';
import type { RatingDistribution } from '@packages/event-contracts/streams';

const SOURCE_SYSTEM = 'almondyoung';

type DbTransaction = Parameters<Parameters<DbService<UgcServiceSchema>['db']['transaction']>[0]>[0];

interface AggregatedReviewStats {
  reviewCount: number;
  ratingSum: number;
  averageRating: number;
  bayesianReviewScore: number;
  ratingDistribution: RatingDistribution;
}

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);
  private readonly bayesianConfidence: number;
  private readonly bayesianPriorMean: number;

  constructor(
    @InjectDb() private readonly db: DbService<UgcServiceSchema>,
    private readonly rewardPolicyService: ReviewRewardPolicyService,
    private readonly rewardPublisher: ReviewRewardPublisher,
    private readonly statsPublisher: ReviewStatsPublisher,
    private readonly configService: ConfigService,
  ) {
    this.bayesianConfidence = Number(this.configService.get('BAYESIAN_CONFIDENCE') ?? 10);
    this.bayesianPriorMean = Number(this.configService.get('BAYESIAN_PRIOR_MEAN') ?? 3.5);
  }

  private get client() {
    return this.db.db;
  }

  private async inTx<T>(fn: (tx: DbTransaction) => Promise<T>, tx?: DbTransaction): Promise<T> {
    return tx ? fn(tx) : this.client.transaction(fn);
  }

  private async aggregateReviewStats(productId: string, tx: DbTransaction): Promise<AggregatedReviewStats> {
    const rows = await tx
      .select({ rating: reviews.rating, count: count() })
      .from(reviews)
      .where(and(eq(reviews.productId, productId), eq(reviews.status, 'active'), isNull(reviews.deletedAt)))
      .groupBy(reviews.rating);

    const distribution: RatingDistribution = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    let reviewCount = 0;
    let ratingSum = 0;

    for (const row of rows) {
      const key = String(row.rating) as keyof RatingDistribution;
      distribution[key] = row.count;
      reviewCount += row.count;
      ratingSum += row.rating * row.count;
    }

    const averageRating = reviewCount > 0 ? ratingSum / reviewCount : 0;

    // Bayesian average: (C * m + n * avg) / (C + n)
    // C: confidence weight (prior review count), m: prior mean
    // When n=0: score reduces to m (prior mean only)
    const C = this.bayesianConfidence;
    const m = this.bayesianPriorMean;
    const bayesianReviewScore = (C * m + reviewCount * averageRating) / (C + reviewCount);

    return {
      reviewCount,
      ratingSum,
      averageRating: reviewCount > 0 ? Math.round(averageRating * 10) / 10 : 0,
      bayesianReviewScore: Math.round(bayesianReviewScore * 1000) / 1000,
      ratingDistribution: distribution,
    };
  }

  private publishStatsAfterCommit(productId: string): void {
    this.inTx((tx) => this.aggregateReviewStats(productId, tx))
      .then((stats) =>
        this.statsPublisher.publishProductReviewStatsChanged({ productId, ...stats }),
      )
      .catch((err: Error) =>
        this.logger.error(`Failed to publish review stats for product ${productId}: ${err.message}`),
      );
  }

  private normalizeMediaFileIds(mediaFileIds?: string[] | null): string[] {
    if (!mediaFileIds) {
      return [];
    }

    if (mediaFileIds.length > MAX_REVIEW_MEDIA_COUNT) {
      throw new BadRequestException(`Media files can be attached up to ${MAX_REVIEW_MEDIA_COUNT}`);
    }

    const uniqueMedia = new Set(mediaFileIds);
    if (uniqueMedia.size !== mediaFileIds.length) {
      throw new BadRequestException('Duplicate media files are not allowed');
    }

    return mediaFileIds;
  }

  private async insertReviewMedia(reviewId: string, mediaFileIds: string[], tx: DbTransaction): Promise<void> {
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

  private async fetchMediaFileIdsByReviewIds(reviewIds: string[], tx: DbTransaction): Promise<Map<string, string[]>> {
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

  private async fetchMediaFileIdsByReviewId(reviewId: string, tx: DbTransaction): Promise<string[]> {
    const mediaMap = await this.fetchMediaFileIdsByReviewIds([reviewId], tx);
    return mediaMap.get(reviewId) ?? [];
  }

  private async fetchReactionCounts(
    reviewIds: string[],
    tx: DbTransaction,
  ): Promise<Map<string, { helpfulCount: number; likeCount: number; dislikeCount: number }>> {
    if (reviewIds.length === 0) {
      return new Map();
    }

    const rows = await tx
      .select({
        targetId: reactions.targetId,
        reactionType: reactions.reactionType,
        count: count(),
      })
      .from(reactions)
      .where(and(eq(reactions.targetType, 'review'), inArray(reactions.targetId, reviewIds)))
      .groupBy(reactions.targetId, reactions.reactionType);

    const countMap = new Map<string, { helpfulCount: number; likeCount: number; dislikeCount: number }>();

    // 모든 reviewId에 대해 기본값 설정
    for (const reviewId of reviewIds) {
      countMap.set(reviewId, { helpfulCount: 0, likeCount: 0, dislikeCount: 0 });
    }

    for (const row of rows) {
      const counts = countMap.get(row.targetId);
      if (counts) {
        if (row.reactionType === 'helpful') {
          counts.helpfulCount = row.count;
        } else if (row.reactionType === 'like') {
          counts.likeCount = row.count;
        } else if (row.reactionType === 'dislike') {
          counts.dislikeCount = row.count;
        }
      }
    }

    return countMap;
  }

  private async fetchCommentsByReviewIds(
    reviewIds: string[],
    tx: DbTransaction,
  ): Promise<Map<string, ReviewCommentEntity>> {
    if (reviewIds.length === 0) {
      return new Map();
    }

    const rows = await tx.select().from(reviewComments).where(inArray(reviewComments.reviewId, reviewIds));

    const commentMap = new Map<string, ReviewCommentEntity>();
    for (const row of rows) {
      commentMap.set(row.reviewId, row);
    }

    return commentMap;
  }

  async createComment(
    adminUserId: string,
    reviewId: string,
    dto: CreateCommentDto,
    tx?: DbTransaction,
  ): Promise<ReviewCommentEntity> {
    return this.inTx(async (tx) => {
      const [review] = await tx
        .select({ id: reviews.id })
        .from(reviews)
        .where(and(eq(reviews.id, reviewId), eq(reviews.status, 'active'), isNull(reviews.deletedAt)));

      if (!review) {
        throw new NotFoundException('Review not found');
      }

      const [existing] = await tx
        .select({ id: reviewComments.id })
        .from(reviewComments)
        .where(eq(reviewComments.reviewId, reviewId));

      if (existing) {
        throw new ConflictException('Comment already exists for this review');
      }

      const [comment] = await tx
        .insert(reviewComments)
        .values({
          reviewId,
          adminUserId,
          content: dto.content,
        })
        .returning();

      return comment;
    }, tx);
  }

  async updateComment(
    adminUserId: string,
    reviewId: string,
    dto: CreateCommentDto,
    tx?: DbTransaction,
  ): Promise<ReviewCommentEntity> {
    return this.inTx(async (tx) => {
      const [comment] = await tx
        .update(reviewComments)
        .set({
          content: dto.content,
          adminUserId,
          updatedAt: new Date(),
        })
        .where(eq(reviewComments.reviewId, reviewId))
        .returning();

      if (!comment) {
        throw new NotFoundException('Comment not found');
      }

      return comment;
    }, tx);
  }

  async deleteComment(reviewId: string, tx?: DbTransaction): Promise<void> {
    return this.inTx(async (tx) => {
      const [comment] = await tx
        .delete(reviewComments)
        .where(eq(reviewComments.reviewId, reviewId))
        .returning({ id: reviewComments.id });

      if (!comment) {
        throw new NotFoundException('Comment not found');
      }
    }, tx);
  }

  async toggleReaction(
    userId: string,
    reviewId: string,
    reactionType: 'helpful' | 'like' | 'dislike',
    tx?: DbTransaction,
  ): Promise<{ marked: boolean; count: number }> {
    return this.inTx(async (tx) => {
      // 리뷰 존재 확인 및 작성자 정보 조회
      const [review] = await tx
        .select({ id: reviews.id, userId: reviews.userId })
        .from(reviews)
        .where(and(eq(reviews.id, reviewId), eq(reviews.status, 'active'), isNull(reviews.deletedAt)));

      if (!review) {
        throw new NotFoundException('Review not found');
      }

      // 자기 리뷰인지 체크
      if (review.userId === userId) {
        throw new BadRequestException('Cannot react to your own review');
      }

      // 기존 reaction 여부 확인
      const [existing] = await tx
        .select({ targetId: reactions.targetId })
        .from(reactions)
        .where(
          and(
            eq(reactions.targetType, 'review'),
            eq(reactions.targetId, reviewId),
            eq(reactions.userId, userId),
            eq(reactions.reactionType, reactionType),
          ),
        );

      let marked: boolean;

      if (existing) {
        // 이미 있으면 삭제
        await tx
          .delete(reactions)
          .where(
            and(
              eq(reactions.targetType, 'review'),
              eq(reactions.targetId, reviewId),
              eq(reactions.userId, userId),
              eq(reactions.reactionType, reactionType),
            ),
          );
        marked = false;
      } else {
        // 없으면 추가
        await tx.insert(reactions).values({
          targetType: 'review',
          targetId: reviewId,
          userId,
          reactionType,
        });
        marked = true;
      }

      // 현재 reaction 카운트 조회
      const [countResult] = await tx
        .select({ count: count() })
        .from(reactions)
        .where(
          and(
            eq(reactions.targetType, 'review'),
            eq(reactions.targetId, reviewId),
            eq(reactions.reactionType, reactionType),
          ),
        );

      return {
        marked,
        count: countResult.count,
      };
    }, tx);
  }

  async create(userId: string, dto: CreateReviewDto, tx?: DbTransaction): Promise<ReviewWithMediaEntity> {
    const rewardHolder: { value: { reviewType: 'TEXT' | 'PHOTO'; amount: number } | null } = { value: null };

    const result = await this.inTx(async (tx) => {
      // 1. 리뷰 작성 자격 검증
      const [eligibility] = await tx
        .select()
        .from(reviewEligibilities)
        .where(
          and(
            eq(reviewEligibilities.id, dto.eligibilityId),
            eq(reviewEligibilities.userId, userId),
            eq(reviewEligibilities.productId, dto.productId),
            isNull(reviewEligibilities.consumedAt),
          ),
        );

      if (!eligibility) {
        throw new BadRequestException('리뷰 작성 자격이 없습니다.');
      }

      // 2. 리뷰 생성
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

      // 3. 자격 소비 처리
      await tx
        .update(reviewEligibilities)
        .set({
          consumedAt: new Date(),
          consumedByReviewId: review.id,
          updatedAt: new Date(),
        })
        .where(eq(reviewEligibilities.id, eligibility.id));

      rewardHolder.value = await this.rewardPolicyService.calculateReward(dto.content.length, mediaFileIds.length, tx);

      return {
        ...review,
        mediaFileIds,
        helpfulCount: 0,
        likeCount: 0,
        dislikeCount: 0,
        adminComment: null,
      };
    }, tx);

    // TX 커밋 후 Kafka command 발행
    // 카프카 이벤트 발행 임시로 막음 : 리뷰 적립금 정책이 올바르게 자리잡을때까지 주석처리
    // const reward = rewardHolder.value;
    // if (reward) {
    //   this.rewardPublisher
    //     .publishEarnPointsCommand({
    //       reviewId: result.id,
    //       userId,
    //       reviewType: reward.reviewType,
    //       amount: reward.amount,
    //       productId: dto.productId,
    //     })
    //     .catch((err) => {
    //       this.logger.error(
    //         `Failed to publish reward command for review ${result.id}: ${err.message}`,
    //       );
    //     });
    // }

    if (!tx) {
      this.publishStatsAfterCommit(dto.productId);
    }

    return result;
  }

  async update(userId: string, id: string, dto: UpdateReviewDto, tx?: DbTransaction): Promise<ReviewWithMediaEntity> {
    let productId: string | undefined;

    const result = await this.inTx(async (tx) => {
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
        .where(and(eq(reviews.id, id), eq(reviews.userId, userId), eq(reviews.sourceSystem, SOURCE_SYSTEM)))
        .returning();

      if (!review) {
        throw new NotFoundException('Review not found');
      }

      productId = review.productId;

      if (hasMediaUpdate) {
        await tx.delete(reviewMedia).where(eq(reviewMedia.reviewId, id));
        await this.insertReviewMedia(id, mediaFileIds, tx);
      }

      const resolvedMediaFileIds = hasMediaUpdate ? mediaFileIds : await this.fetchMediaFileIdsByReviewId(id, tx);

      const reactionCountMap = await this.fetchReactionCounts([id], tx);
      const counts = reactionCountMap.get(id) ?? { helpfulCount: 0, likeCount: 0, dislikeCount: 0 };
      const commentMap = await this.fetchCommentsByReviewIds([id], tx);

      return {
        ...review,
        mediaFileIds: resolvedMediaFileIds,
        helpfulCount: counts.helpfulCount,
        likeCount: counts.likeCount,
        dislikeCount: counts.dislikeCount,
        adminComment: commentMap.get(id) ?? null,
      };
    }, tx);

    if (!tx && productId) {
      this.publishStatsAfterCommit(productId);
    }

    return result;
  }

  async remove(userId: string, id: string, tx?: DbTransaction): Promise<void> {
    let productId: string | undefined;

    await this.inTx(async (tx) => {
      const [review] = await tx
        .update(reviews)
        .set({
          deletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(reviews.id, id),
            eq(reviews.userId, userId),
            eq(reviews.sourceSystem, SOURCE_SYSTEM),
            isNull(reviews.deletedAt),
          ),
        )
        .returning({ id: reviews.id, productId: reviews.productId });

      if (!review) {
        throw new NotFoundException('Review not found');
      }

      productId = review.productId;
    }, tx);

    if (!tx && productId) {
      this.publishStatsAfterCommit(productId);
    }
  }

  async deleteByAdmin(id: string, tx?: DbTransaction): Promise<void> {
    let productId: string | undefined;

    await this.inTx(async (tx) => {
      const [review] = await tx
        .update(reviews)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(reviews.id, id), isNull(reviews.deletedAt)))
        .returning({ id: reviews.id, productId: reviews.productId });

      if (!review) {
        throw new NotFoundException('Review not found');
      }

      productId = review.productId;
    }, tx);

    if (!tx && productId) {
      this.publishStatsAfterCommit(productId);
    }
  }

  async getRatingSummary(productId: string, tx?: DbTransaction) {
    return this.inTx(async (tx) => {
      const rows = await tx
        .select({ rating: reviews.rating, count: count() })
        .from(reviews)
        .where(and(eq(reviews.productId, productId), eq(reviews.status, 'active'), isNull(reviews.deletedAt)))
        .groupBy(reviews.rating);

      const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      let totalCount = 0;
      let weightedSum = 0;

      for (const row of rows) {
        distribution[row.rating] = row.count;
        totalCount += row.count;
        weightedSum += row.rating * row.count;
      }

      const averageRating = totalCount > 0 ? Math.round((weightedSum / totalCount) * 10) / 10 : 0;

      return {
        productId,
        averageRating,
        totalCount,
        ratingDistribution: distribution,
      };
    }, tx);
  }

  async listByUser(
    userId: string,
    query: MyReviewListQueryDto,
    tx?: DbTransaction,
  ): Promise<PaginatedResponseDto<ReviewWithMediaEntity>> {
    return this.inTx(async (tx) => {
      const page = query.page ?? 1;
      const limit = query.limit ?? 20;
      const offset = (page - 1) * limit;

      const conditions: SQL[] = [eq(reviews.userId, userId), eq(reviews.status, 'active'), isNull(reviews.deletedAt)];

      if (query.productId) {
        conditions.push(eq(reviews.productId, query.productId));
      }

      // 기간 필터
      if (query.period && query.period !== 'all') {
        const months = query.period === '6months' ? 6 : 12;
        const cutoffDate = new Date();
        cutoffDate.setMonth(cutoffDate.getMonth() - months);
        conditions.push(gte(reviews.createdAt, cutoffDate));
      }

      // 타입 필터 (photo: 미디어 있음, text: 미디어 없음)
      if (query.type === 'photo') {
        conditions.push(
          exists(
            tx.select({ _: sql`1` }).from(reviewMedia).where(eq(reviewMedia.reviewId, reviews.id)),
          ),
        );
      } else if (query.type === 'text') {
        conditions.push(
          notExists(
            tx.select({ _: sql`1` }).from(reviewMedia).where(eq(reviewMedia.reviewId, reviews.id)),
          ),
        );
      }

      const whereClause = and(...conditions);

      const [{ count: total }] = await tx.select({ count: count() }).from(reviews).where(whereClause);

      const orderByClause = {
        latest: desc(reviews.createdAt),
        oldest: asc(reviews.createdAt),
        rating_high: desc(reviews.rating),
        rating_low: asc(reviews.rating),
      }[query.sort ?? 'latest'];

      const data = await tx
        .select()
        .from(reviews)
        .where(whereClause)
        .orderBy(orderByClause)
        .limit(limit)
        .offset(offset);

      const reviewIds = data.map((review) => review.id);

      const mediaMap = await this.fetchMediaFileIdsByReviewIds(reviewIds, tx);
      const reactionCountMap = await this.fetchReactionCounts(reviewIds, tx);
      const commentMap = await this.fetchCommentsByReviewIds(reviewIds, tx);

      return {
        data: data.map((review) => {
          const counts = reactionCountMap.get(review.id) ?? { helpfulCount: 0, likeCount: 0, dislikeCount: 0 };
          return {
            ...review,
            mediaFileIds: mediaMap.get(review.id) ?? [],
            helpfulCount: counts.helpfulCount,
            likeCount: counts.likeCount,
            dislikeCount: counts.dislikeCount,
            adminComment: commentMap.get(review.id) ?? null,
          };
        }),
        total,
        page,
        limit,
      };
    }, tx);
  }

  // ─── 관리자용 ───

  async listAllForAdmin(
    query: AdminReviewListQueryDto,
    tx?: DbTransaction,
  ): Promise<PaginatedResponseDto<ReviewWithMediaEntity>> {
    return this.inTx(async (tx) => {
      const page = query.page ?? 1;
      const limit = query.limit ?? 20;
      const offset = (page - 1) * limit;

      const conditions: SQL[] = [];

      if (query.status === 'deleted') {
        conditions.push(isNotNull(reviews.deletedAt));
      } else if (query.status) {
        conditions.push(eq(reviews.status, query.status));
        conditions.push(isNull(reviews.deletedAt));
      } else {
        conditions.push(isNull(reviews.deletedAt));
      }

      if (query.rating) {
        if (query.rating === 'positive') {
          conditions.push(inArray(reviews.rating, [4, 5]));
        } else if (query.rating === 'negative') {
          conditions.push(inArray(reviews.rating, [1, 2]));
        } else {
          conditions.push(eq(reviews.rating, Number(query.rating)));
        }
      }

      if (query.productId) {
        const productIdTerm = `%${query.productId}%`;
        conditions.push(sql`${reviews.productId}::text ILIKE ${productIdTerm}`);
      }

      if (query.hasComment === 'true') {
        conditions.push(
          exists(
            tx.select({ _: sql`1` }).from(reviewComments).where(eq(reviewComments.reviewId, reviews.id)),
          ),
        );
      } else if (query.hasComment === 'false') {
        conditions.push(
          notExists(
            tx.select({ _: sql`1` }).from(reviewComments).where(eq(reviewComments.reviewId, reviews.id)),
          ),
        );
      }

      if (query.q) {
        const searchTerm = `%${query.q}%`;
        conditions.push(
          sql`(${reviews.content} ILIKE ${searchTerm} OR COALESCE(${reviews.legacyAuthorName}, '') ILIKE ${searchTerm})`,
        );
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const [{ count: total }] = await tx.select({ count: count() }).from(reviews).where(whereClause);

      const orderByClause = {
        latest: desc(reviews.createdAt),
        oldest: asc(reviews.createdAt),
        rating_high: desc(reviews.rating),
        rating_low: asc(reviews.rating),
      }[query.sort ?? 'latest'];

      const data = await tx
        .select()
        .from(reviews)
        .where(whereClause)
        .orderBy(orderByClause)
        .limit(limit)
        .offset(offset);

      const reviewIds = data.map((review) => review.id);
      const mediaMap = await this.fetchMediaFileIdsByReviewIds(reviewIds, tx);
      const reactionCountMap = await this.fetchReactionCounts(reviewIds, tx);
      const commentMap = await this.fetchCommentsByReviewIds(reviewIds, tx);

      return {
        data: data.map((review) => {
          const counts = reactionCountMap.get(review.id) ?? { helpfulCount: 0, likeCount: 0, dislikeCount: 0 };
          return {
            ...review,
            mediaFileIds: mediaMap.get(review.id) ?? [],
            helpfulCount: counts.helpfulCount,
            likeCount: counts.likeCount,
            dislikeCount: counts.dislikeCount,
            adminComment: commentMap.get(review.id) ?? null,
          };
        }),
        total,
        page,
        limit,
      };
    }, tx);
  }

  async getReviewForAdmin(id: string, tx?: DbTransaction): Promise<ReviewWithMediaEntity> {
    return this.inTx(async (tx) => {
      const [review] = await tx.select().from(reviews).where(eq(reviews.id, id));

      if (!review) {
        throw new NotFoundException('Review not found');
      }

      const mediaFileIds = await this.fetchMediaFileIdsByReviewId(id, tx);
      const reactionCountMap = await this.fetchReactionCounts([id], tx);
      const counts = reactionCountMap.get(id) ?? { helpfulCount: 0, likeCount: 0, dislikeCount: 0 };
      const commentMap = await this.fetchCommentsByReviewIds([id], tx);

      return {
        ...review,
        mediaFileIds,
        helpfulCount: counts.helpfulCount,
        likeCount: counts.likeCount,
        dislikeCount: counts.dislikeCount,
        adminComment: commentMap.get(id) ?? null,
      };
    }, tx);
  }

  async updateStatus(id: string, status: ReviewStatus, tx?: DbTransaction): Promise<ReviewWithMediaEntity> {
    let productId: string | undefined;

    const result = await this.inTx(async (tx) => {
      const [review] = await tx
        .update(reviews)
        .set({ status, updatedAt: new Date() })
        .where(and(eq(reviews.id, id), isNull(reviews.deletedAt)))
        .returning();

      if (!review) {
        throw new NotFoundException('Review not found');
      }

      productId = review.productId;

      const mediaFileIds = await this.fetchMediaFileIdsByReviewId(id, tx);
      const reactionCountMap = await this.fetchReactionCounts([id], tx);
      const counts = reactionCountMap.get(id) ?? { helpfulCount: 0, likeCount: 0, dislikeCount: 0 };
      const commentMap = await this.fetchCommentsByReviewIds([id], tx);

      return {
        ...review,
        mediaFileIds,
        helpfulCount: counts.helpfulCount,
        likeCount: counts.likeCount,
        dislikeCount: counts.dislikeCount,
        adminComment: commentMap.get(id) ?? null,
      };
    }, tx);

    if (!tx && productId) {
      this.publishStatsAfterCommit(productId);
    }

    return result;
  }

  async listByProduct(
    query: ReviewListQueryDto,
    tx?: DbTransaction,
  ): Promise<PaginatedResponseDto<ReviewWithMediaEntity>> {
    return this.inTx(async (tx) => {
      const page = query.page ?? 1;
      const limit = query.limit ?? 20;
      const offset = (page - 1) * limit;

      const conditions: SQL[] = [eq(reviews.productId, query.productId), eq(reviews.status, 'active'), isNull(reviews.deletedAt)];

      if (query.rating) {
        if (query.rating === 'positive') {
          conditions.push(inArray(reviews.rating, [4, 5]));
        } else if (query.rating === 'negative') {
          conditions.push(inArray(reviews.rating, [1, 2]));
        } else {
          conditions.push(eq(reviews.rating, Number(query.rating)));
        }
      }

      if (query.type === 'photo') {
        conditions.push(
          exists(
            tx.select({ _: sql`1` }).from(reviewMedia).where(eq(reviewMedia.reviewId, reviews.id)),
          ),
        );
      } else if (query.type === 'text') {
        conditions.push(
          notExists(
            tx.select({ _: sql`1` }).from(reviewMedia).where(eq(reviewMedia.reviewId, reviews.id)),
          ),
        );
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const [{ count: total }] = await tx
        .select({ count: count() })
        .from(reviews)
        .where(whereClause);

      const orderByClause = {
        latest: desc(reviews.createdAt),
        oldest: asc(reviews.createdAt),
        rating_high: desc(reviews.rating),
        rating_low: asc(reviews.rating),
      }[query.sort ?? 'latest'];

      const data = await tx
        .select()
        .from(reviews)
        .where(whereClause)
        .orderBy(orderByClause)
        .limit(limit)
        .offset(offset);

      const reviewIds = data.map((review) => review.id);

      const mediaMap = await this.fetchMediaFileIdsByReviewIds(reviewIds, tx);
      const reactionCountMap = await this.fetchReactionCounts(reviewIds, tx);
      const commentMap = await this.fetchCommentsByReviewIds(reviewIds, tx);

      return {
        data: data.map((review) => {
          const counts = reactionCountMap.get(review.id) ?? { helpfulCount: 0, likeCount: 0, dislikeCount: 0 };
          return {
            ...review,
            mediaFileIds: mediaMap.get(review.id) ?? [],
            helpfulCount: counts.helpfulCount,
            likeCount: counts.likeCount,
            dislikeCount: counts.dislikeCount,
            adminComment: commentMap.get(review.id) ?? null,
          };
        }),
        total,
        page,
        limit,
      };
    }, tx);
  }
}
