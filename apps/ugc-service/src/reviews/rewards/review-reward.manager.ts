import { Injectable, Logger } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { and, inArray, isNull } from 'drizzle-orm';
import { reviewEligibilities, type UgcServiceSchema } from '../../db/schema';
import { ReviewRewardGrantService } from './review-reward-grant.service';
import { ReviewRewardReader } from './review-reward.reader';
import { UgcTx } from './review-reward-rule.service';
import { ReviewRewardPublisher } from '../services/review-reward-publisher.service';
import { CancellationInput, CancellationSkipReason, planCancellation } from './order-cancellation.policy';
import { ReturnInput, ReturnLineSkipReason, ReturnSkipReason, planReturn } from './order-return.policy';
import { ReviewRewardRevokeReason } from './review-reward-grant.service';

export interface CancellationRevocationResult {
  skipped: CancellationSkipReason | null;
  /** 무효화한 «미소비» 자격 수 */
  invalidatedEligibilities: number;
  /** 회수한 지급 건수 (= 발행한 취소 명령 수) */
  revokedGrants: number;
}

export interface ReturnRevocationResult {
  skipped: ReturnSkipReason | null;
  invalidatedEligibilities: number;
  revokedGrants: number;
  /** 회수하지 «않은» 라인과 그 사유. 「회수 0건」을 성공으로 읽지 않기 위해 센다. */
  skippedLines: Array<{ salesOrderLineId: string; skipReason: ReturnLineSkipReason }>;
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

      const outcome = await this.revokeEligibilities(trx, eligibilities, plan.revokeReason);

      this.logger.log(
        `[order-cancelled] channelOrderId=${plan.channelOrderId}, reason=${plan.revokeReason}, 자격=${outcome.touchedEligibilities}, 회수=${outcome.revokedGrants}`,
      );

      return {
        skipped: null,
        invalidatedEligibilities: outcome.invalidatedEligibilities,
        revokedGrants: outcome.revokedGrants,
      };
    }, tx);
  }

  /**
   * 반품이 완료되면 그 «라인의» 자격과 이미 나간 적립을 되돌린다.
   *
   * 취소와 배관은 같고 대상 선정만 다르다 — 취소는 주문 전체, 반품은 전량 반품된 라인만이다.
   * 회수하지 않은 라인은 사유와 함께 결과에 실어 돌려준다.
   */
  async revokeForReturnedOrder(input: ReturnInput, tx?: UgcTx): Promise<ReturnRevocationResult> {
    const plan = planReturn(input);
    if (plan.action === 'SKIP') {
      this.logger.log(
        `[order-returned] 회수 대상 아님 (${plan.skipReason}): channelOrderId=${input.channelOrderId ?? '-'}, ` +
          `제외 라인=${JSON.stringify(plan.skippedLines)}`,
      );
      return {
        skipped: plan.skipReason,
        invalidatedEligibilities: 0,
        revokedGrants: 0,
        skippedLines: plan.skippedLines,
      };
    }

    return this.db.run(async (trx) => {
      const eligibilities = await this.reader.findLiveEligibilitiesByOrderLineIds(
        plan.channelOrderId,
        plan.orderLineIds,
        trx,
      );
      if (eligibilities.length === 0) {
        return { skipped: null, invalidatedEligibilities: 0, revokedGrants: 0, skippedLines: plan.skippedLines };
      }

      const outcome = await this.revokeEligibilities(trx, eligibilities, plan.revokeReason);

      this.logger.log(
        `[order-returned] channelOrderId=${plan.channelOrderId}, reason=${plan.revokeReason}, ` +
          `자격=${outcome.touchedEligibilities}, 회수=${outcome.revokedGrants}, 제외 라인=${plan.skippedLines.length}`,
      );

      return {
        skipped: null,
        invalidatedEligibilities: outcome.invalidatedEligibilities,
        revokedGrants: outcome.revokedGrants,
        skippedLines: plan.skippedLines,
      };
    }, tx);
  }

  /**
   * 자격 무효화 → 소비된 자격의 지급 회수 → wallet 취소 «명령» 적재. 취소·반품이 공유한다.
   *
   * `revoked_at IS NULL` 조건과 `status = 'GRANTED'` 조건이 이 경로의 멱등성이다 —
   * 같은 이벤트가 재전달되면 0행을 돌려주고 취소 명령도 0건이 된다.
   */
  private async revokeEligibilities(
    trx: UgcTx,
    eligibilities: Array<{ id: string }>,
    revokeReason: ReviewRewardRevokeReason,
  ): Promise<{ touchedEligibilities: number; invalidatedEligibilities: number; revokedGrants: number }> {
    const now = new Date();
    // 소비된 자격도 회수 표시를 남긴다 — 리뷰는 유지하되 「취소·반품된 주문의 자격」임을 남기는 것이
    // 감사 기록이다. 콘텐츠를 내릴지는 관리자가 화면에서 고른다(자동으로 내리지 않는다).
    const invalidated = await trx
      .update(reviewEligibilities)
      .set({ revokedAt: now, revokeReason, updatedAt: now })
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

    const revoked = await this.grantService.revokeForReviews(reviewIds, revokeReason, trx);

    for (const grant of revoked) {
      await this.publisher.enqueueCancelPointsCommand(
        {
          grantId: grant.grantId,
          reviewId: grant.reviewId,
          userId: grant.userId,
          reasonCode: `review-reward-cancel:${revokeReason.toLowerCase()}`,
        },
        trx,
      );
    }

    return {
      touchedEligibilities: invalidated.length,
      invalidatedEligibilities: invalidated.filter((row) => row.consumedByReviewId === null).length,
      revokedGrants: revoked.length,
    };
  }
}
