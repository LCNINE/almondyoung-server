import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, inArray } from 'drizzle-orm';
import type { DbService } from '@app/db';
import {
  reviewMedia,
  reviewRewardGrants,
  reviewRewardRules,
  reviews,
  ugcServiceSchema,
  type UgcServiceSchema,
} from '../../db/schema';
import { ReviewsService } from '../services/reviews.service';
import { ReviewRewardGrantService } from './review-reward-grant.service';
import { ReviewRewardRuleService } from './review-reward-rule.service';
import { DEFAULT_REWARD_CONDITIONS, DEFAULT_REWARD_LIMITS } from './reward-rule.types';

/**
 * 「적립 받고 빠져나가는 길」이 삭제 말고도 막히는지를 실 Postgres 로 검증한다.
 * 재판정은 지급 원장과 «지급한 규칙»을 조인해 조건을 다시 읽으므로, 목으로는 그 SQL 이
 * 실제로 맞는 행을 고르는지 알 수 없다.
 *
 * 실행: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ugc \
 *   npx jest --testPathPattern="review-reward-revocation.edit-hide.integration"
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

interface CancelCommand {
  grantId: string;
  reviewId: string;
  userId: string;
  reasonCode: string;
}

describeIfDb('리뷰 수정·숨김도 보상을 회수한다 (실 Postgres)', () => {
  jest.setTimeout(120_000);

  const userId = randomUUID();
  const productId = randomUUID();

  /** 사진 1장 + 본문 10자 이상이어야 지급되는 규칙. 재판정이 되돌아볼 조건이다. */
  const PHOTO_RULE_ID = randomUUID();

  let sql: postgres.Sql;
  let db: ReturnType<typeof drizzle<UgcServiceSchema>>;
  let service: ReviewsService;
  let cancelCommands: CancelCommand[];

  const createdReviewIds: string[] = [];

  beforeAll(async () => {
    sql = postgres(DATABASE_URL as string, { max: 2 });
    db = drizzle(sql, { schema: ugcServiceSchema });

    const dbService = {
      db,
      run: (fn: (trx: unknown) => unknown, tx?: unknown) => (tx ? fn(tx) : db.transaction(fn as never)),
    } as unknown as DbService<UgcServiceSchema>;

    const grantService = new ReviewRewardGrantService(dbService, new ReviewRewardRuleService(dbService));

    service = new ReviewsService(
      dbService,
      { consume: jest.fn(), linkConsumedReview: jest.fn() } as never,
      grantService,
      {
        enqueueEarnPointsCommand: jest.fn(),
        enqueueCancelPointsCommand: jest.fn(async (cmd: CancelCommand) => {
          cancelCommands.push(cmd);
        }),
      } as never,
      { publishProductReviewStatsChanged: jest.fn() } as never,
      { get: () => undefined } as never,
    );

    await db.insert(reviewRewardRules).values({
      id: PHOTO_RULE_ID,
      name: 'edit-hide-itest 사진 리뷰',
      trigger: 'ON_REVIEW_CREATED',
      // 공유 로컬 DB 의 다른 경로가 이 규칙을 집지 않도록 비활성으로 둔다.
      // 재판정은 «지급 원장이 가리키는» 규칙을 읽으므로 활성 여부와 무관하다.
      active: false,
      priority: 100,
      stopOnMatch: true,
      conditions: { ...DEFAULT_REWARD_CONDITIONS, minMediaCount: 1, minContentLength: 10 },
      reward: { kind: 'POINT_FIXED', amount: 500, expiresInDays: 30 },
      limits: { ...DEFAULT_REWARD_LIMITS },
    });
  });

  beforeEach(() => {
    cancelCommands = [];
  });

  afterAll(async () => {
    if (createdReviewIds.length > 0) {
      await db.delete(reviewRewardGrants).where(inArray(reviewRewardGrants.reviewId, createdReviewIds));
      await db.delete(reviewMedia).where(inArray(reviewMedia.reviewId, createdReviewIds));
      await db.delete(reviews).where(inArray(reviews.id, createdReviewIds));
    }
    await db.delete(reviewRewardRules).where(eq(reviewRewardRules.id, PHOTO_RULE_ID));
    await sql.end();
  });

  /** 사진 3장으로 500원을 이미 «받은» 리뷰를 만든다. */
  async function seedGrantedPhotoReview(options: { trigger?: 'ON_REVIEW_CREATED' | 'WEEKLY_BEST'; amount?: number } = {}) {
    const reviewId = randomUUID();
    createdReviewIds.push(reviewId);

    await db.insert(reviews).values({
      id: reviewId,
      userId,
      productId,
      rating: 5,
      content: '사진과 함께 남긴 충분히 긴 리뷰 본문',
    });
    await db.insert(reviewMedia).values(
      [0, 1, 2].map((order) => ({ reviewId, fileId: randomUUID(), order })),
    );
    await db.insert(reviewRewardGrants).values({
      reviewId,
      userId,
      ruleId: PHOTO_RULE_ID,
      trigger: options.trigger ?? 'ON_REVIEW_CREATED',
      rewardKind: 'POINT_FIXED',
      amount: options.amount ?? 500,
      status: 'GRANTED',
    });

    return reviewId;
  }

  async function grantStatuses(reviewId: string): Promise<{ status: string; revokeReason: string | null }[]> {
    return db
      .select({ status: reviewRewardGrants.status, revokeReason: reviewRewardGrants.revokeReason })
      .from(reviewRewardGrants)
      .where(eq(reviewRewardGrants.reviewId, reviewId));
  }

  describe('㉠ 숨김', () => {
    it('숨기면 원장이 REVOKED 가 되고 취소 명령이 한 건 나간다', async () => {
      const reviewId = await seedGrantedPhotoReview();

      await service.updateStatus(reviewId, 'hidden');

      expect(await grantStatuses(reviewId)).toEqual([{ status: 'REVOKED', revokeReason: 'REVIEW_HIDDEN' }]);
      expect(cancelCommands).toEqual([
        expect.objectContaining({ reviewId, userId, reasonCode: 'review-reward-cancel:hidden' }),
      ]);
    });

    it('다시 숨겨도 두 번 회수되지 않는다 — 취소 명령 0건', async () => {
      const reviewId = await seedGrantedPhotoReview();
      await service.updateStatus(reviewId, 'hidden');
      cancelCommands = [];

      await service.updateStatus(reviewId, 'hidden');

      expect(cancelCommands).toEqual([]);
    });

    it('active 로 되돌려도 재적립하지 않는다 — 원장은 REVOKED 로 남는다', async () => {
      const reviewId = await seedGrantedPhotoReview();
      await service.updateStatus(reviewId, 'hidden');
      cancelCommands = [];

      await service.updateStatus(reviewId, 'active');

      expect(await grantStatuses(reviewId)).toEqual([{ status: 'REVOKED', revokeReason: 'REVIEW_HIDDEN' }]);
      expect(cancelCommands).toEqual([]);
    });

    it('0원 지급(BADGE 등)은 되돌릴 적립이 없어 취소 명령이 안 나간다', async () => {
      const reviewId = await seedGrantedPhotoReview({ amount: 0 });

      await service.updateStatus(reviewId, 'hidden');

      expect(await grantStatuses(reviewId)).toEqual([{ status: 'REVOKED', revokeReason: 'REVIEW_HIDDEN' }]);
      expect(cancelCommands).toEqual([]);
    });
  });

  describe('㉡ 수정 — 재판정(㉮)', () => {
    it('사진 3장 → 0장이면 조건을 잃어 회수한다', async () => {
      const reviewId = await seedGrantedPhotoReview();

      await service.update(userId, reviewId, { mediaFileIds: [] } as never);

      expect(await grantStatuses(reviewId)).toEqual([
        { status: 'REVOKED', revokeReason: 'REVIEW_EDITED_BELOW_THRESHOLD' },
      ]);
      expect(cancelCommands).toEqual([
        expect.objectContaining({ reasonCode: 'review-reward-cancel:edited_below_threshold' }),
      ]);
    });

    it('본문을 조건 아래로 줄이면 회수한다', async () => {
      const reviewId = await seedGrantedPhotoReview();

      await service.update(userId, reviewId, { content: '짧다' } as never);

      expect(await grantStatuses(reviewId)).toEqual([
        { status: 'REVOKED', revokeReason: 'REVIEW_EDITED_BELOW_THRESHOLD' },
      ]);
    });

    it('조건을 유지한 수정은 회수하지 않는다', async () => {
      const reviewId = await seedGrantedPhotoReview();

      await service.update(userId, reviewId, { content: '내용을 고쳤지만 여전히 충분히 길다' } as never);

      expect(await grantStatuses(reviewId)).toEqual([{ status: 'GRANTED', revokeReason: null }]);
      expect(cancelCommands).toEqual([]);
    });

    it('사진을 «더» 붙여도 추가 지급도 회수도 없다 — 올려주지 않는다(㉮)', async () => {
      const reviewId = randomUUID();
      createdReviewIds.push(reviewId);
      await db.insert(reviews).values({
        id: reviewId,
        userId,
        productId,
        rating: 5,
        content: '사진 없이 시작한 충분히 긴 리뷰 본문',
      });

      await service.update(userId, reviewId, { mediaFileIds: [randomUUID(), randomUUID()] } as never);

      expect(await grantStatuses(reviewId)).toEqual([]);
      expect(cancelCommands).toEqual([]);
    });

    it('주간 베스트 지급은 본문을 고쳐도 되돌리지 않는다 — 「뽑혔다」는 사실에 대한 지급이다', async () => {
      const reviewId = await seedGrantedPhotoReview({ trigger: 'WEEKLY_BEST' });

      await service.update(userId, reviewId, { mediaFileIds: [] } as never);

      expect(await grantStatuses(reviewId)).toEqual([{ status: 'GRANTED', revokeReason: null }]);
      expect(cancelCommands).toEqual([]);
    });
  });

  it('새 회수 사유는 원장 컬럼 길이(40)를 넘지 않는다', () => {
    expect('REVIEW_EDITED_BELOW_THRESHOLD'.length).toBeLessThanOrEqual(40);
  });
});
