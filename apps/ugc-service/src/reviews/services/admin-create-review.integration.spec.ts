import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { inArray } from 'drizzle-orm';
import { NotFoundException } from '@nestjs/common';
import { reviewMedia, reviews, ugcServiceSchema } from '../../db/schema';
import { ADMIN_MANUAL_SOURCE_SYSTEM } from '../../source-system';
import { ReviewsService } from './reviews.service';

/**
 * 관리자 수기 리뷰가 실 DB 에서 «이관분과 같은 모양»으로 동작하는지.
 *
 * 실행:
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ugc_admin_manual_it \
 *     npx jest --runInBand --testPathPattern="admin-create-review.integration"
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('관리자 수기 리뷰 (실 Postgres)', () => {
  jest.setTimeout(120_000);

  const productId = randomUUID();
  const adminId = randomUUID();
  const createdIds: string[] = [];

  let sql: postgres.Sql;
  let service: ReviewsService;
  let rewardGrantService: { evaluateForNewReview: jest.Mock; recordSkippedForNewReview: jest.Mock };

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    const db = drizzle(sql, { schema: ugcServiceSchema });
    rewardGrantService = { evaluateForNewReview: jest.fn(), recordSkippedForNewReview: jest.fn() };
    service = new ReviewsService(
      { db } as never,
      { consume: jest.fn(), linkConsumedReview: jest.fn() } as never,
      rewardGrantService as never,
      { enqueueEarnPointsCommand: jest.fn() } as never,
      { publishProductReviewStatsChanged: jest.fn().mockResolvedValue(undefined) } as never,
      { get: () => undefined } as never,
    );
  });

  afterAll(async () => {
    if (createdIds.length > 0) {
      const db = drizzle(sql, { schema: ugcServiceSchema });
      await db.delete(reviewMedia).where(inArray(reviewMedia.reviewId, createdIds));
      await db.delete(reviews).where(inArray(reviews.id, createdIds));
    }
    await sql.end();
  });

  const create = async (overrides: Partial<{ rating: number; writtenAt: string }> = {}) => {
    const review = await service.createByAdmin(adminId, {
      productId,
      authorName: '홍길동',
      writtenAt: overrides.writtenAt ?? '2020-01-15T00:00:00+09:00',
      rating: overrides.rating ?? 4,
      content: '다른 채널에서 옮겨 온 후기',
      mediaFileIds: [randomUUID()],
    });
    createdIds.push(review.id);
    return review;
  };

  it('저장한 원 작성 시각이 그대로 돌아온다 (timestamp 왕복)', async () => {
    const { id } = await create();
    const stored = await service.getReviewForAdmin(id);

    expect(stored.createdAt.toISOString()).toBe('2020-01-14T15:00:00.000Z');
    expect(stored.userId).toBeNull();
    expect(stored.reviewPermissionId).toBeNull();
    expect(stored.sourceSystem).toBe(ADMIN_MANUAL_SOURCE_SYSTEM);
    expect(stored.createdByAdminUserId).toBe(adminId);
    expect(stored.legacyAuthorName).toBe('홍길동');
    expect(stored.legacyImportedAt).toBeInstanceOf(Date);
    expect(stored.mediaFileIds).toHaveLength(1);
    expect(rewardGrantService.evaluateForNewReview).not.toHaveBeenCalled();
    expect(rewardGrantService.recordSkippedForNewReview).not.toHaveBeenCalled();
  });

  it('공개 상품 리뷰 목록과 평점 요약에 일반 리뷰처럼 잡힌다', async () => {
    await create({ rating: 2 });

    const list = await service.listByProduct({ productId } as never);
    expect(list.data.map((r) => r.id)).toEqual(expect.arrayContaining(createdIds));

    const summary = await service.getRatingSummary(productId);
    expect(summary.totalCount).toBe(createdIds.length);
  });

  it('관리자 목록에서 sourceSystem 으로 모아 볼 수 있다', async () => {
    const page = await service.listAllForAdmin({
      sourceSystem: ADMIN_MANUAL_SOURCE_SYSTEM,
      productId,
      limit: 50,
    } as never);
    expect(page.data.map((r) => r.id).sort()).toEqual([...createdIds].sort());
  });

  it('어떤 회원도 회원용 수정·삭제로 건드릴 수 없다', async () => {
    const [id] = createdIds;
    const someone = randomUUID();

    await expect(service.update(someone, id, { content: '바꿔치기' } as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.remove(someone, id)).rejects.toBeInstanceOf(NotFoundException);

    const after = await service.getReviewForAdmin(id);
    expect(after.content).toBe('다른 채널에서 옮겨 온 후기');
    expect(after.deletedAt).toBeNull();
  });
});
