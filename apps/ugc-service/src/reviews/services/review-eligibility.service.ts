import { Injectable, Logger } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { and, count, desc, eq, gte, isNotNull, isNull, type SQL } from 'drizzle-orm';
import { reviewEligibilities, type UgcServiceSchema } from '../../db/schema';
import { ReviewEligibilityListQueryDto } from '../dto/review-eligibility-query.dto';
import { CreateReviewEligibilityDto } from '../dto/create-review-eligibility.dto';
import { type ReviewEligibilityEntity } from '../types';
import { PaginatedResponseDto } from '@app/shared/dto';

type DbTransaction = Parameters<Parameters<DbService<UgcServiceSchema>['db']['transaction']>[0]>[0];

@Injectable()
export class ReviewEligibilityService {
  private static readonly ELIGIBILITY_EXPIRATION_DAYS = 15; // 리뷰 자격 만료 기간

  private readonly logger = new Logger(ReviewEligibilityService.name);

  constructor(@InjectDb() private readonly db: DbService<UgcServiceSchema>) {}

  private get client() {
    return this.db.db;
  }

  private async inTx<T>(fn: (tx: DbTransaction) => Promise<T>, tx?: DbTransaction): Promise<T> {
    return tx ? fn(tx) : this.client.transaction(fn);
  }

  async create(dto: CreateReviewEligibilityDto, tx?: DbTransaction): Promise<ReviewEligibilityEntity[]> {
    return this.inTx(async (tx) => {
      const now = new Date();
      const expiresAt = new Date(
        now.getTime() + ReviewEligibilityService.ELIGIBILITY_EXPIRATION_DAYS * 24 * 60 * 60 * 1000,
      );

      const values = dto.items.map((item) => ({
        userId: dto.userId,
        productId: item.productId,
        orderId: dto.orderId,
        orderLineId: item.orderLineId,
        eligibleAt: now,
        expiresAt,
        sourceSystem: 'almondyoung' as const,
        sourceEventId: `order:${dto.orderId}:${item.orderLineId}`,
      }));

      const created = await tx.insert(reviewEligibilities).values(values).onConflictDoNothing().returning();

      this.logger.log(
        `[create] Created ${created.length} eligibilities for orderId=${dto.orderId}, userId=${dto.userId}`,
      );

      return created;
    }, tx);
  }

  async listByUser(
    userId: string,
    query: ReviewEligibilityListQueryDto,
    tx?: DbTransaction,
  ): Promise<PaginatedResponseDto<ReviewEligibilityEntity>> {
    return this.inTx(async (tx) => {
      const page = query.page ?? 1;
      const limit = query.limit ?? 20;
      const offset = (page - 1) * limit;

      const conditions: SQL[] = [eq(reviewEligibilities.userId, userId)];

      const status = query.status ?? 'available';
      if (status === 'available') {
        conditions.push(isNull(reviewEligibilities.consumedAt));
        conditions.push(gte(reviewEligibilities.expiresAt, new Date()));
      } else {
        conditions.push(isNotNull(reviewEligibilities.consumedAt));
      }

      if (query.productId) {
        conditions.push(eq(reviewEligibilities.productId, query.productId));
      }

      if (query.orderId) {
        conditions.push(eq(reviewEligibilities.orderId, query.orderId));
      }

      const whereClause = and(...conditions);

      const [{ count: total }] = await tx.select({ count: count() }).from(reviewEligibilities).where(whereClause);

      const data = await tx
        .select()
        .from(reviewEligibilities)
        .where(whereClause)
        .orderBy(desc(reviewEligibilities.eligibleAt))
        .limit(limit)
        .offset(offset);

      return { data, total, page, limit };
    }, tx);
  }
}
