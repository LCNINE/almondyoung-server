import { Injectable } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
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

  /**
   * 그 주문의 «지정한 라인만». 반품은 부분이 기본이라 라인으로 좁히지 않으면 반품하지 않은
   * 라인의 자격까지 죽는다. `order_line_id` 는 전역 unique 지만 주문 조건을 함께 걸어
   * 잘못된 라인 목록이 다른 주문을 건드리지 못하게 한다.
   */
  async findLiveEligibilitiesByOrderLineIds(
    orderId: string,
    orderLineIds: string[],
    tx?: UgcTx,
  ): Promise<OrderEligibilityRow[]> {
    if (orderLineIds.length === 0) return [];
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
          .where(
            and(
              eq(reviewEligibilities.orderId, orderId),
              inArray(reviewEligibilities.orderLineId, orderLineIds),
              isNull(reviewEligibilities.revokedAt),
            ),
          ),
      tx,
    );
  }
}
