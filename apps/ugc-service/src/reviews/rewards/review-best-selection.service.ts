import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { and, count, desc, eq, gte, inArray, isNotNull, isNull, lt, sql, SQL } from 'drizzle-orm';
import { reactions, reviewBestSelections, reviewMedia, reviews, type UgcServiceSchema } from '../../db/schema';
import { ReviewRewardGrantService } from './review-reward-grant.service';
import { ReviewRewardRuleService, UgcTx } from './review-reward-rule.service';
import { ReviewRewardPublisher } from '../services/review-reward-publisher.service';
import { isRuleInWindow } from './reward-rule.evaluator';
import { BestSelectionStatus } from './reward-rule.types';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export interface BestSelectionRow {
  id: string;
  periodStart: Date;
  periodEnd: Date;
  reviewId: string;
  userId: string;
  ruleId: string | null;
  rank: number;
  helpfulCount: number;
  status: BestSelectionStatus;
  confirmedAt: Date | null;
  rating: number;
  content: string;
  productId: string;
}

/** 지난 주(KST 월요일 00:00 ~ 다음 월요일 00:00)의 구간 */
export function previousWeekRange(now: Date): { start: Date; end: Date } {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const weekday = kst.getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  const thisMonday = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - daysSinceMonday);

  return {
    start: new Date(thisMonday - 7 * 24 * 60 * 60 * 1000 - KST_OFFSET_MS),
    end: new Date(thisMonday - KST_OFFSET_MS),
  };
}

/**
 * 주간 베스트 리뷰. 집계는 후보(CANDIDATE)까지만 만들고 지급은 관리자 확정 뒤에 나간다 —
 * 추천수는 지인 클릭으로 밀 수 있어 마지막 판단은 사람이 한다.
 */
@Injectable()
export class ReviewBestSelectionService {
  private readonly logger = new Logger(ReviewBestSelectionService.name);

  constructor(
    @InjectDb() private readonly db: DbService<UgcServiceSchema>,
    private readonly ruleService: ReviewRewardRuleService,
    private readonly grantService: ReviewRewardGrantService,
    private readonly rewardPublisher: ReviewRewardPublisher,
  ) {}

  /**
   * 활성 WEEKLY_BEST 규칙마다 지난 주 후보를 만든다. 이미 만든 회차는 건드리지 않는다.
   * 활성 규칙이 없으면 아무 일도 하지 않는다 — 기본 상태에서 이 잡은 조회 한 번으로 끝난다.
   */
  async generateCandidates(now = new Date()): Promise<{ created: number; period: { start: Date; end: Date } }> {
    const period = previousWeekRange(now);
    const rules = (await this.ruleService.getActiveRules('WEEKLY_BEST')).filter((rule) => isRuleInWindow(rule, now));

    if (rules.length === 0) {
      return { created: 0, period };
    }

    let created = 0;

    for (const rule of rules) {
      const best = rule.conditions.best;
      if (!best || best.topN <= 0) continue;

      const candidates = await this.findCandidates(rule.id, period, {
        mode: best.mode,
        topN: best.topN,
        minHelpfulCount: best.minHelpfulCount,
        minContentLength: rule.conditions.minContentLength,
        minMediaCount: rule.conditions.minMediaCount,
        minRating: rule.conditions.minRating,
      });

      for (const [index, candidate] of candidates.entries()) {
        const inserted = await this.db.run((trx) =>
          trx
            .insert(reviewBestSelections)
            .values({
              periodStart: period.start,
              periodEnd: period.end,
              reviewId: candidate.reviewId,
              userId: candidate.userId,
              ruleId: rule.id,
              rank: index + 1,
              helpfulCount: candidate.helpfulCount,
              status: 'CANDIDATE',
            })
            .onConflictDoNothing()
            .returning({ id: reviewBestSelections.id }),
        );

        created += inserted.length;
      }
    }

    this.logger.log(
      `주간 베스트 후보 생성: ${created}건 (${period.start.toISOString()} ~ ${period.end.toISOString()})`,
    );

    return { created, period };
  }

  async list(
    query: { status?: BestSelectionStatus; periodStart?: Date; page: number; limit: number },
    tx?: UgcTx,
  ): Promise<{ data: BestSelectionRow[]; total: number }> {
    return this.db.run(async (trx) => {
      const conditions: SQL[] = [];
      if (query.status) conditions.push(eq(reviewBestSelections.status, query.status));
      if (query.periodStart) conditions.push(eq(reviewBestSelections.periodStart, query.periodStart));
      const where = conditions.length ? and(...conditions) : undefined;

      const rows = await trx
        .select({
          id: reviewBestSelections.id,
          periodStart: reviewBestSelections.periodStart,
          periodEnd: reviewBestSelections.periodEnd,
          reviewId: reviewBestSelections.reviewId,
          userId: reviewBestSelections.userId,
          ruleId: reviewBestSelections.ruleId,
          rank: reviewBestSelections.rank,
          helpfulCount: reviewBestSelections.helpfulCount,
          status: reviewBestSelections.status,
          confirmedAt: reviewBestSelections.confirmedAt,
          rating: reviews.rating,
          content: reviews.content,
          productId: reviews.productId,
        })
        .from(reviewBestSelections)
        .innerJoin(reviews, eq(reviews.id, reviewBestSelections.reviewId))
        .where(where)
        .orderBy(desc(reviewBestSelections.periodStart), reviewBestSelections.rank)
        .limit(query.limit)
        .offset((query.page - 1) * query.limit);

      const [totalRow] = await trx.select({ value: count() }).from(reviewBestSelections).where(where);

      return { data: rows, total: totalRow?.value ?? 0 };
    }, tx);
  }

  /** 확정 — 여기서 비로소 지급이 나간다 */
  async confirm(selectionId: string, adminUserId: string): Promise<{ granted: boolean; amount: number }> {
    return this.db.run(async (trx) => {
      const [selection] = await trx
        .select({
          id: reviewBestSelections.id,
          reviewId: reviewBestSelections.reviewId,
          userId: reviewBestSelections.userId,
          ruleId: reviewBestSelections.ruleId,
          status: reviewBestSelections.status,
          productId: reviews.productId,
        })
        .from(reviewBestSelections)
        .innerJoin(reviews, eq(reviews.id, reviewBestSelections.reviewId))
        .where(eq(reviewBestSelections.id, selectionId))
        .limit(1);

      if (!selection) {
        throw new NotFoundException(`베스트 리뷰 선정 건을 찾을 수 없습니다: ${selectionId}`);
      }
      if (selection.status !== 'CANDIDATE') {
        throw new ConflictException(`이미 처리된 선정 건입니다: ${selection.status}`);
      }
      if (!selection.ruleId) {
        throw new BadRequestException('규칙이 삭제된 선정 건은 확정할 수 없습니다.');
      }

      const rule = await this.ruleService.getById(selection.ruleId, trx);
      const reward = rule.reward;

      if (reward.kind === 'POINT_RATE') {
        throw new BadRequestException('주간 베스트 규칙에는 정률 보상을 쓸 수 없습니다. 정액 또는 비금전으로 바꾸세요.');
      }

      await trx
        .update(reviewBestSelections)
        .set({ status: 'CONFIRMED', confirmedBy: adminUserId, confirmedAt: new Date(), updatedAt: new Date() })
        .where(eq(reviewBestSelections.id, selectionId));

      if (reward.kind === 'NONE') {
        return { granted: false, amount: 0 };
      }

      const mediaCount = await this.countMedia(selection.reviewId, trx);
      const amount = reward.kind === 'POINT_FIXED' ? reward.amount : 0;
      const expiresAt =
        reward.kind === 'POINT_FIXED' && reward.expiresInDays ? addDays(new Date(), reward.expiresInDays) : null;

      const granted = await this.grantService.grantForBestSelection(
        {
          reviewId: selection.reviewId,
          userId: selection.userId,
          ruleId: rule.id,
          selectionId,
          rewardKind: reward.kind,
          amount,
          expiresAt,
          mediaCount,
        },
        trx,
      );

      if (granted) {
        await this.rewardPublisher.enqueueEarnPointsCommand(
          {
            grantId: granted.grantId,
            reviewId: granted.reviewId,
            userId: granted.userId,
            reviewType: granted.reviewType,
            amount: granted.amount,
            reasonCode: granted.reasonCode,
            productId: selection.productId,
            expiresAt: granted.expiresAt,
          },
          trx,
        );
      }

      return { granted: granted !== null, amount };
    });
  }

  async reject(selectionId: string, adminUserId: string): Promise<void> {
    const updated = await this.db.run((trx) =>
      trx
        .update(reviewBestSelections)
        .set({ status: 'REJECTED', confirmedBy: adminUserId, confirmedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(reviewBestSelections.id, selectionId), eq(reviewBestSelections.status, 'CANDIDATE')))
        .returning({ id: reviewBestSelections.id }),
    );

    if (updated.length === 0) {
      throw new NotFoundException(`확정 대기 중인 선정 건이 아닙니다: ${selectionId}`);
    }
  }

  /** 확정된 베스트 리뷰 id 들 — 상품 화면의 뱃지·상단 고정이 쓴다 */
  async listConfirmedReviewIds(reviewIds: string[], tx?: UgcTx): Promise<Set<string>> {
    if (reviewIds.length === 0) return new Set();

    const rows = await this.db.run(
      (trx) =>
        trx
          .select({ reviewId: reviewBestSelections.reviewId })
          .from(reviewBestSelections)
          .where(
            and(eq(reviewBestSelections.status, 'CONFIRMED'), inArray(reviewBestSelections.reviewId, reviewIds)),
          ),
      tx,
    );

    return new Set(rows.map((row) => row.reviewId));
  }

  private async countMedia(reviewId: string, tx: UgcTx): Promise<number> {
    const [row] = await tx.select({ value: count() }).from(reviewMedia).where(eq(reviewMedia.reviewId, reviewId));
    return row?.value ?? 0;
  }

  private async findCandidates(
    ruleId: string,
    period: { start: Date; end: Date },
    spec: {
      mode: 'HELPFUL_COUNT' | 'RANDOM';
      topN: number;
      minHelpfulCount: number;
      minContentLength: number;
      minMediaCount: number;
      minRating: number | null;
    },
  ): Promise<Array<{ reviewId: string; userId: string; helpfulCount: number }>> {
    const conditions: SQL[] = [
      gte(reviews.createdAt, period.start),
      lt(reviews.createdAt, period.end),
      eq(reviews.status, 'active'),
      isNull(reviews.deletedAt),
      isNotNull(reviews.userId),
      // 이관된 리뷰는 우리 회원의 작성분이 아니라 보상 대상이 아니다.
      eq(reviews.sourceSystem, 'almondyoung'),
      sql`char_length(${reviews.content}) >= ${spec.minContentLength}`,
    ];

    if (spec.minRating !== null) {
      conditions.push(gte(reviews.rating, spec.minRating));
    }

    const rows = await this.db.run((trx) => {
      // 상관 서브쿼리는 빌더로 짠다. 원시 sql 템플릿 안의 컬럼 참조는 «쿼리에 테이블이 하나뿐일 때»
      // 테이블 이름을 잃어 `"id"` 로만 나가고, 같은 fragment 라도 select 목록에서는 한정을 잃고
      // where 절에서는 유지되는 식으로 갈린다. 안쪽 표에 같은 이름의 컬럼이 생기는 순간
      // 조건이 조용히 항상 거짓이 된다 — 베스트 뱃지가 그렇게 사라졌었다.
      const helpfulCount = sql<number>`(${trx
        .select({ value: count() })
        .from(reactions)
        .where(
          and(
            eq(reactions.targetType, 'review'),
            eq(reactions.targetId, reviews.id),
            eq(reactions.reactionType, 'helpful'),
          ),
        )})`;

      const mediaCount = sql<number>`(${trx
        .select({ value: count() })
        .from(reviewMedia)
        .where(eq(reviewMedia.reviewId, reviews.id))})`;

      const allConditions = [...conditions];
      if (spec.minMediaCount > 0) {
        allConditions.push(sql`${mediaCount} >= ${spec.minMediaCount}`);
      }
      if (spec.mode === 'HELPFUL_COUNT' && spec.minHelpfulCount > 0) {
        allConditions.push(sql`${helpfulCount} >= ${spec.minHelpfulCount}`);
      }

      return trx
        .select({
          reviewId: reviews.id,
          userId: reviews.userId,
          helpfulCount: helpfulCount.as('helpful_count'),
        })
        .from(reviews)
        .where(and(...allConditions))
        .orderBy(spec.mode === 'RANDOM' ? sql`random()` : sql`helpful_count desc, ${reviews.createdAt} asc`)
        .limit(spec.topN);
    });

    this.logger.debug(`규칙 ${ruleId}: 후보 ${rows.length}건`);

    // userId 가 없는 행은 위 where 에서 걸러지지만, 타입상 null 이 남으므로 여기서도 확인한다.
    return rows
      .filter((row): row is typeof row & { userId: string } => row.userId !== null)
      .map((row) => ({
        reviewId: row.reviewId,
        userId: row.userId,
        helpfulCount: Number(row.helpfulCount ?? 0),
      }));
  }
}

function addDays(from: Date, days: number): Date {
  const expires = new Date(from);
  expires.setUTCDate(expires.getUTCDate() + days);
  return expires;
}
