import { Injectable } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { and, count, desc, eq, isNotNull, isNull, type SQL } from 'drizzle-orm';
import { reviewEligibilities, type UgcServiceSchema } from '../../db/schema';
import { ReviewEligibilityListQueryDto } from '../dto/review-eligibility-query.dto';
import { type ReviewEligibilityEntity } from '../types';
import { PaginatedResponseDto } from '@app/shared/dto';

type DbTransaction = Parameters<Parameters<DbService<UgcServiceSchema>['db']['transaction']>[0]>[0];

@Injectable()
export class ReviewEligibilityService {
  constructor(@InjectDb() private readonly db: DbService<UgcServiceSchema>) {}

  private get client() {
    return this.db.db;
  }

  private async inTx<T>(fn: (tx: DbTransaction) => Promise<T>, tx?: DbTransaction): Promise<T> {
    return tx ? fn(tx) : this.client.transaction(fn);
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
