import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { and, count, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { reviews, type UgcServiceSchema } from '../db/schema';
import { CreateReviewDto } from './dto/create-review.dto';
import { ReviewListQueryDto } from './dto/review-list-query.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { type ReviewEntity } from './types';
import { PaginatedResponseDto } from '@app/shared/dto';

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

  async create(
    userId: string,
    dto: CreateReviewDto,
    tx?: DbTransaction,
  ): Promise<ReviewEntity> {
    return this.inTx(async (tx) => {
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

      return review;
    }, tx);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateReviewDto,
    tx?: DbTransaction,
  ): Promise<ReviewEntity> {
    return this.inTx(async (tx) => {
      const updateData: Partial<ReviewEntity> = {
        updatedAt: new Date(),
      };

      if (dto.rating !== undefined) {
        updateData.rating = dto.rating;
      }

      if (dto.content !== undefined) {
        updateData.content = dto.content;
      }

      if (Object.keys(updateData).length === 1) {
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

      return review;
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
  ): Promise<PaginatedResponseDto<ReviewEntity>> {
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

      const dataQuery = tx
        .select()
        .from(reviews)
        .orderBy(desc(reviews.createdAt))
        .limit(limit)
        .offset(offset);

      if (whereClause) {
        dataQuery.where(whereClause);
      }

      const data = await dataQuery;

      return {
        data,
        total,
        page,
        limit,
      };
    }, tx);
  }
}
