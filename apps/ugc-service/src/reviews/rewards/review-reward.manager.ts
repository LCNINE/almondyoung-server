import { Injectable, Logger } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { and, inArray, isNull } from 'drizzle-orm';
import { reviewEligibilities, type UgcServiceSchema } from '../../db/schema';
import { ReviewRewardGrantService } from './review-reward-grant.service';
import { ReviewRewardReader } from './review-reward.reader';
import { UgcTx } from './review-reward-rule.service';
import { ReviewRewardPublisher } from '../services/review-reward-publisher.service';
import { CancellationInput, CancellationSkipReason, planCancellation } from './order-cancellation.policy';

export interface CancellationRevocationResult {
  skipped: CancellationSkipReason | null;
  /** 무효화한 «미소비» 자격 수 */
  invalidatedEligibilities: number;
  /** 회수한 지급 건수 (= 발행한 취소 명령 수) */
  revokedGrants: number;
}

/**
 * 주문 취소에 따른 자격·적립 회수. 쓰기는 전부 여기 모인다.
 *
 * wallet 원장은 직접 건드리지 않는다 — 취소 명령을 같은 트랜잭션의 아웃박스에 넣고
 * 그쪽이 처리한다(원장엔 회수인데 명령만 유실되는 창을 없앤다).
 */
@Injectable()
export class ReviewRewardManager {
  private readonly logger = new Logger(ReviewRewardManager.name);

  constructor(
    @InjectDb() private readonly db: DbService<UgcServiceSchema>,
    private readonly reader: ReviewRewardReader,
    private readonly grantService: ReviewRewardGrantService,
    private readonly publisher: ReviewRewardPublisher,
  ) {}

  async revokeForCancelledOrder(input: CancellationInput, tx?: UgcTx): Promise<CancellationRevocationResult> {
    const plan = planCancellation(input);
    if (plan.action === 'SKIP') {
      this.logger.log(
        `[order-cancelled] 회수 대상 아님 (${plan.skipReason}): channelOrderId=${input.channelOrderId ?? '-'}, scope=${input.cancellationScope}`,
      );
      return { skipped: plan.skipReason, invalidatedEligibilities: 0, revokedGrants: 0 };
    }

    return this.db.run(async (trx) => {
      const eligibilities = await this.reader.findLiveEligibilitiesByOrderId(plan.channelOrderId, trx);
      if (eligibilities.length === 0) {
        return { skipped: null, invalidatedEligibilities: 0, revokedGrants: 0 };
      }

      const now = new Date();
      // 소비된 자격도 회수 표시를 남긴다 — 리뷰는 유지하되 「취소된 주문의 자격」임을 남기는 것이 감사 기록이다.
      const invalidated = await trx
        .update(reviewEligibilities)
        .set({ revokedAt: now, revokeReason: plan.revokeReason, updatedAt: now })
        .where(
          and(
            inArray(
              reviewEligibilities.id,
              eligibilities.map((row) => row.id),
            ),
            isNull(reviewEligibilities.revokedAt),
          ),
        )
        .returning({ id: reviewEligibilities.id, consumedByReviewId: reviewEligibilities.consumedByReviewId });

      const reviewIds = invalidated
        .map((row) => row.consumedByReviewId)
        .filter((reviewId): reviewId is string => reviewId !== null);

      const revoked = await this.grantService.revokeForReviews(reviewIds, plan.revokeReason, trx);

      for (const grant of revoked) {
        await this.publisher.enqueueCancelPointsCommand(
          {
            grantId: grant.grantId,
            reviewId: grant.reviewId,
            userId: grant.userId,
            reasonCode: `review-reward-cancel:${plan.revokeReason.toLowerCase()}`,
          },
          trx,
        );
      }

      this.logger.log(
        `[order-cancelled] channelOrderId=${plan.channelOrderId}, reason=${plan.revokeReason}, 자격=${invalidated.length}, 회수=${revoked.length}`,
      );

      return {
        skipped: null,
        invalidatedEligibilities: invalidated.filter((row) => row.consumedByReviewId === null).length,
        revokedGrants: revoked.length,
      };
    }, tx);
  }

}
