import { Injectable } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { and, eq, isNull } from 'drizzle-orm';
import { reviewEligibilities, type UgcServiceSchema } from '../../db/schema';
import { UgcTx } from './review-reward-rule.service';

export interface OrderEligibilityRow {
  id: string;
  userId: string;
  orderLineId: string;
  consumedByReviewId: string | null;
}

/**
 * 보상·자격 조회 전담. 쓰기는 manager 가 한다 (Controller → Service → Reader/Manager 규약).
 */
@Injectable()
export class ReviewRewardReader {
  constructor(@InjectDb() private readonly db: DbService<UgcServiceSchema>) {}

  /**
   * 아직 회수되지 않은 그 주문의 자격 전부. `orderId` 는 Medusa 주문 id 축이다
   * (`SalesOrderCancelled.channelOrderId` 와 같은 축).
   */
  async findLiveEligibilitiesByOrderId(orderId: string, tx?: UgcTx): Promise<OrderEligibilityRow[]> {
    return this.db.run(
      async (trx) =>
        trx
          .select({
            id: reviewEligibilities.id,
            userId: reviewEligibilities.userId,
            orderLineId: reviewEligibilities.orderLineId,
            consumedByReviewId: reviewEligibilities.consumedByReviewId,
          })
          .from(reviewEligibilities)
          .where(and(eq(reviewEligibilities.orderId, orderId), isNull(reviewEligibilities.revokedAt))),
      tx,
    );
  }
}
