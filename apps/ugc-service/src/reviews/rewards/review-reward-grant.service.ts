import { Injectable, Logger } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { and, count, desc, eq, gte, inArray, isNull, sql, SQL } from 'drizzle-orm';
import { PaginatedResponseDto } from '@app/shared/dto';
import { reviewRewardGrants, reviews, type UgcServiceSchema } from '../../db/schema';
import { ReviewRewardRuleService, UgcTx } from './review-reward-rule.service';
import {
  applyLimits,
  periodStart,
  resolveReviewType,
  RewardDecision,
  ReviewFacts,
  selectRule,
  UsageFacts,
} from './reward-rule.evaluator';
import {
  ReviewRewardGrantStatus,
  ReviewRewardKind,
  ReviewRewardLimitSpec,
  ReviewRewardSkipReason,
  ReviewRewardTrigger,
} from './reward-rule.types';

/**
 * 1인당 한도가 세는 상태. 회수된 건도 «기회를 이미 썼다»로 본다 — 위 loadUsage 주석 참조.
 */
const PER_USER_LIMIT_STATUSES: readonly ReviewRewardGrantStatus[] = ['GRANTED', 'REVOKED'];

/** 전체 예산 한도가 세는 상태. 회수는 돈이 돌아온 것이라 예산도 돌려준다. */
const BUDGET_LIMIT_STATUSES: readonly ReviewRewardGrantStatus[] = ['GRANTED'];

export interface NewReviewRewardInput {
  reviewId: string;
  userId: string;
  contentLength: number;
  mediaCount: number;
  rating: number;
  /** 리뷰가 소비한 자격의 주문 라인 금액. 모르면 null */
  orderLineAmount: number | null;
}

export interface GrantedPoints {
  grantId: string;
  reviewId: string;
  userId: string;
  reviewType: 'TEXT' | 'PHOTO';
  amount: number;
  expiresAt: Date | null;
  reasonCode: string;
}

export interface GrantRow {
  id: string;
  reviewId: string;
  userId: string;
  ruleId: string | null;
  trigger: ReviewRewardTrigger;
  rewardKind: ReviewRewardKind;
  amount: number;
  expiresAt: Date | null;
  status: ReviewRewardGrantStatus;
  skipReason: ReviewRewardSkipReason | null;
  revokedAt: Date | null;
  createdAt: Date;
}

/**
 * 지급 판정과 원장. 판정 자체는 evaluator 의 순수 함수가 하고,
 * 이 서비스는 판정에 필요한 사실을 모아 오고 결과를 원장에 남기는 일만 한다.
 */
@Injectable()
export class ReviewRewardGrantService {
  private readonly logger = new Logger(ReviewRewardGrantService.name);

  constructor(
    @InjectDb() private readonly db: DbService<UgcServiceSchema>,
    private readonly ruleService: ReviewRewardRuleService,
  ) {}

  /**
   * 리뷰 작성 시점의 보상 판정. 반드시 리뷰 생성 트랜잭션 안에서 부른다.
   * 포인트가 나가야 하면 그 내용을 돌려주고, 실제 발행(아웃박스 적재)은 호출자가 같은 tx 에서 한다.
   *
   * 활성 규칙이 0건이면(=기본 상태) 원장에 아무것도 쓰지 않는다 — 무보상은 사건이 아니다.
   */
  async evaluateForNewReview(input: NewReviewRewardInput, tx: UgcTx): Promise<GrantedPoints | null> {
    const rules = await this.ruleService.getActiveRules('ON_REVIEW_CREATED', tx);
    if (rules.length === 0) {
      return null;
    }

    const now = new Date();
    const needsSequence = rules.some((rule) => rule.conditions.everyNthReview !== null);

    const facts: ReviewFacts = {
      contentLength: input.contentLength,
      mediaCount: input.mediaCount,
      rating: input.rating,
      userReviewSequence: needsSequence ? await this.countUserReviews(input.userId, tx) : 1,
      orderLineAmount: input.orderLineAmount,
    };

    const selected = selectRule(rules, facts, now);
    let decision = selected.decision;

    if (selected.rule && decision.status === 'GRANTED') {
      const usage = await this.loadUsage(selected.rule.id, input.userId, selected.rule.limits, now, tx);
      decision = applyLimits(decision, selected.rule.limits, usage);
    }

    return this.persistDecision(input, decision, 'ON_REVIEW_CREATED', now, tx);
  }

  /**
   * 확정된 베스트 리뷰의 지급. selectionId 로 어느 회차 선정이었는지 남긴다.
   */
  async grantForBestSelection(
    params: {
      reviewId: string;
      userId: string;
      ruleId: string;
      selectionId: string;
      rewardKind: ReviewRewardKind;
      amount: number;
      expiresAt: Date | null;
      mediaCount: number;
    },
    tx: UgcTx,
  ): Promise<GrantedPoints | null> {
    const [row] = await tx
      .insert(reviewRewardGrants)
      .values({
        reviewId: params.reviewId,
        userId: params.userId,
        ruleId: params.ruleId,
        trigger: 'WEEKLY_BEST',
        rewardKind: params.rewardKind,
        amount: params.amount,
        expiresAt: params.expiresAt,
        status: 'GRANTED',
        selectionId: params.selectionId,
      })
      .returning({ id: reviewRewardGrants.id });

    if (params.amount <= 0) {
      return null;
    }

    return {
      grantId: row.id,
      reviewId: params.reviewId,
      userId: params.userId,
      reviewType: resolveReviewType(params.mediaCount),
      amount: params.amount,
      expiresAt: params.expiresAt,
      reasonCode: 'review-reward:weekly-best',
    };
  }

  /**
   * 리뷰가 사라졌을 때의 회수. 지급된 포인트 원장 행을 REVOKED 로 바꾸고,
   * 취소해야 할 지급 건을 돌려준다 — 적립 받고 지우기를 막는 유일한 길이다.
   */
  async revokeForReview(
    reviewId: string,
    reason: 'REVIEW_DELETED' | 'REVIEW_HIDDEN',
    tx: UgcTx,
  ): Promise<Array<{ grantId: string; userId: string; amount: number }>> {
    const revoked = await tx
      .update(reviewRewardGrants)
      .set({ status: 'REVOKED', revokedAt: new Date(), revokeReason: reason, updatedAt: new Date() })
      .where(and(eq(reviewRewardGrants.reviewId, reviewId), eq(reviewRewardGrants.status, 'GRANTED')))
      .returning({
        grantId: reviewRewardGrants.id,
        userId: reviewRewardGrants.userId,
        amount: reviewRewardGrants.amount,
      });

    return revoked.filter((row) => row.amount > 0);
  }

  async list(
    query: { page: number; limit: number; status?: ReviewRewardGrantStatus; userId?: string },
    tx?: UgcTx,
  ): Promise<PaginatedResponseDto<GrantRow>> {
    return this.db.run(async (trx) => {
      const conditions: SQL[] = [];
      if (query.status) conditions.push(eq(reviewRewardGrants.status, query.status));
      if (query.userId) conditions.push(eq(reviewRewardGrants.userId, query.userId));
      const where = conditions.length ? and(...conditions) : undefined;

      const rows = await trx
        .select({
          id: reviewRewardGrants.id,
          reviewId: reviewRewardGrants.reviewId,
          userId: reviewRewardGrants.userId,
          ruleId: reviewRewardGrants.ruleId,
          trigger: reviewRewardGrants.trigger,
          rewardKind: reviewRewardGrants.rewardKind,
          amount: reviewRewardGrants.amount,
          expiresAt: reviewRewardGrants.expiresAt,
          status: reviewRewardGrants.status,
          skipReason: reviewRewardGrants.skipReason,
          revokedAt: reviewRewardGrants.revokedAt,
          createdAt: reviewRewardGrants.createdAt,
        })
        .from(reviewRewardGrants)
        .where(where)
        .orderBy(desc(reviewRewardGrants.createdAt))
        .limit(query.limit)
        .offset((query.page - 1) * query.limit);

      const [totalRow] = await trx.select({ value: count() }).from(reviewRewardGrants).where(where);

      return {
        data: rows.map((row) => ({ ...row, skipReason: row.skipReason ?? null })),
        total: totalRow?.value ?? 0,
        page: query.page,
        limit: query.limit,
      };
    }, tx);
  }

  /** 기간별 지급 총액·건수와 미지급 사유 분포. 관리자 화면의 요약 카드가 쓴다 */
  async summarize(since: Date, tx?: UgcTx) {
    return this.db.run(async (trx) => {
      const [granted] = await trx
        .select({
          count: count(),
          amount: sql<number>`coalesce(sum(${reviewRewardGrants.amount}), 0)`,
        })
        .from(reviewRewardGrants)
        .where(and(eq(reviewRewardGrants.status, 'GRANTED'), gte(reviewRewardGrants.createdAt, since)));

      const [revoked] = await trx
        .select({
          count: count(),
          amount: sql<number>`coalesce(sum(${reviewRewardGrants.amount}), 0)`,
        })
        .from(reviewRewardGrants)
        .where(and(eq(reviewRewardGrants.status, 'REVOKED'), gte(reviewRewardGrants.createdAt, since)));

      const skipped = await trx
        .select({ skipReason: reviewRewardGrants.skipReason, count: count() })
        .from(reviewRewardGrants)
        .where(and(eq(reviewRewardGrants.status, 'SKIPPED'), gte(reviewRewardGrants.createdAt, since)))
        .groupBy(reviewRewardGrants.skipReason);

      return {
        since: since.toISOString(),
        granted: { count: granted?.count ?? 0, amount: Number(granted?.amount ?? 0) },
        revoked: { count: revoked?.count ?? 0, amount: Number(revoked?.amount ?? 0) },
        skipped: skipped.map((row) => ({ reason: row.skipReason ?? 'UNKNOWN', count: row.count })),
      };
    }, tx);
  }

  private async persistDecision(
    input: NewReviewRewardInput,
    decision: RewardDecision,
    trigger: ReviewRewardTrigger,
    now: Date,
    tx: UgcTx,
  ): Promise<GrantedPoints | null> {
    const reviewType = resolveReviewType(input.mediaCount);

    if (decision.status === 'SKIPPED') {
      // 규칙 자체가 없어서 안 나간 건 원장에 남기지 않는다 — 기본 상태를 로그로 채우지 않기 위해서다.
      if (decision.skipReason === 'NO_ACTIVE_RULE') return null;

      await tx.insert(reviewRewardGrants).values({
        reviewId: input.reviewId,
        userId: input.userId,
        ruleId: decision.ruleId,
        trigger,
        rewardKind: decision.rewardKind,
        amount: 0,
        status: 'SKIPPED',
        skipReason: decision.skipReason,
      });

      return null;
    }

    const [row] = await tx
      .insert(reviewRewardGrants)
      .values({
        reviewId: input.reviewId,
        userId: input.userId,
        ruleId: decision.ruleId,
        trigger,
        rewardKind: decision.rewardKind,
        amount: decision.amount,
        expiresAt: decision.expiresAt,
        status: 'GRANTED',
      })
      .returning({ id: reviewRewardGrants.id });

    if (decision.rewardKind === 'BADGE' || decision.amount <= 0) {
      // 비금전 보상은 원장에만 남는다 — 지갑으로 나갈 것이 없다.
      return null;
    }

    this.logger.log(
      `리뷰 보상 지급 판정: reviewId=${input.reviewId}, ruleId=${decision.ruleId}, amount=${decision.amount}`,
    );

    return {
      grantId: row.id,
      reviewId: input.reviewId,
      userId: input.userId,
      reviewType,
      amount: decision.amount,
      expiresAt: decision.expiresAt,
      reasonCode: `review-reward:${reviewType.toLowerCase()}`,
    };
  }

  private async countUserReviews(userId: string, tx: UgcTx): Promise<number> {
    const [row] = await tx
      .select({ value: count() })
      .from(reviews)
      .where(and(eq(reviews.userId, userId), isNull(reviews.deletedAt)));

    return row?.value ?? 0;
  }

  /**
   * 한도 계산은 **같은 규칙이 지급한 건들**만 센다. 규칙마다 자기 한도를 갖는 편이
   * 관리자가 화면에서 읽은 대로 동작한다 — 여러 규칙의 지급이 서로의 한도를 깎으면 예측이 안 된다.
   *
   * 두 한도는 «목적이 달라» 회수(REVOKED)를 다르게 센다.
   * - **1인당 한도는 남용 방지**다. 회수된 건도 세지 않으면 리뷰를 썼다 지우기만 해도 한도가
   *   비워져 같은 사람이 무한히 다시 받는다. 지금 있는 회수 사유는 `REVIEW_DELETED`·`REVIEW_HIDDEN`
   *   둘뿐이고 **둘 다 오지급 정정이 아니라 고객·운영자 사유**라, 기회를 되돌려 줄 이유가 없다.
   * - **전체 예산 한도는 실제 지출 통제**다. 회수는 돈이 돌아온 것이므로 예산도 돌아와야 한다.
   *   여기서 회수분까지 세면 쓰지도 않은 예산이 잠긴다.
   *
   * 오지급 정정용 회수 사유가 생기면 1인당 쪽에서 그 사유만 빼는 것이 다음 갈래다.
   */
  private async loadUsage(
    ruleId: string,
    userId: string,
    limits: { perUser: ReviewRewardLimitSpec | null; global: ReviewRewardLimitSpec | null },
    now: Date,
    tx: UgcTx,
  ): Promise<{ perUser: UsageFacts; global: UsageFacts }> {
    const empty: UsageFacts = { count: 0, amount: 0 };

    const perUser = limits.perUser
      ? await this.aggregateGrants(ruleId, userId, periodStart(limits.perUser.period, now), PER_USER_LIMIT_STATUSES, tx)
      : empty;

    const global = limits.global
      ? await this.aggregateGrants(ruleId, null, periodStart(limits.global.period, now), BUDGET_LIMIT_STATUSES, tx)
      : empty;

    return { perUser, global };
  }

  private async aggregateGrants(
    ruleId: string,
    userId: string | null,
    since: Date | null,
    statuses: readonly ReviewRewardGrantStatus[],
    tx: UgcTx,
  ): Promise<UsageFacts> {
    const conditions: SQL[] = [
      eq(reviewRewardGrants.ruleId, ruleId),
      inArray(reviewRewardGrants.status, [...statuses]),
    ];
    if (userId) conditions.push(eq(reviewRewardGrants.userId, userId));
    if (since) conditions.push(gte(reviewRewardGrants.createdAt, since));

    const [row] = await tx
      .select({
        count: count(),
        amount: sql<number>`coalesce(sum(${reviewRewardGrants.amount}), 0)`,
      })
      .from(reviewRewardGrants)
      .where(and(...conditions));

    return { count: row?.count ?? 0, amount: Number(row?.amount ?? 0) };
  }
}
