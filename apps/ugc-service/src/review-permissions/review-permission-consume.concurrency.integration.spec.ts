import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, inArray, sql as raw } from 'drizzle-orm';
import type { DbService } from '@app/db';
import { reviewEligibilities, reviews, ugcServiceSchema, type UgcServiceSchema, type UgcTx } from '../db/schema';
import { ReviewPermissionService } from './review-permission.service';

/**
 * 「자격 하나로 리뷰 하나」가 «동시 요청»에서도 참인지를 실 Postgres 두 커넥션으로 검증한다.
 *
 * 목으로는 확인할 수 없다 — 관건이 READ COMMITTED 아래에서 두 트랜잭션이 같은 행을 어떻게
 * 보느냐이고, 그건 실제 잠금과 재평가가 있어야만 드러난다. 두 트랜잭션을 «확인이 끝난 지점»에서
 * 겹치도록 배리어로 세운다.
 *
 * 실행: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ugc \
 *   npx jest --testPathPattern="review-permission-consume.concurrency.integration"
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('자격 소비는 동시 요청에서도 한 번만 통과한다 (실 Postgres)', () => {
  jest.setTimeout(120_000);

  const userId = randomUUID();
  const productId = randomUUID();

  let sql: postgres.Sql;
  let db: ReturnType<typeof drizzle<UgcServiceSchema>>;
  let service: ReviewPermissionService;

  const createdPermissionIds: string[] = [];

  beforeAll(async () => {
    // 두 트랜잭션이 «진짜로» 겹치려면 커넥션이 둘 이상이어야 한다. max:1 이면 직렬화돼
    // 결함이 재현되지 않는다 — 재현 실패를 「고쳐졌다」로 오독하기 딱 좋은 자리다.
    sql = postgres(DATABASE_URL as string, { max: 4 });
    db = drizzle(sql, { schema: ugcServiceSchema });
    service = new ReviewPermissionService({
      db,
      run: (fn: (trx: unknown) => unknown, tx?: unknown) => (tx ? fn(tx) : db.transaction(fn as never)),
    } as unknown as DbService<UgcServiceSchema>);
  });

  afterAll(async () => {
    if (createdPermissionIds.length > 0) {
      await db.delete(reviews).where(inArray(reviews.reviewPermissionId, createdPermissionIds));
      await db.delete(reviewEligibilities).where(inArray(reviewEligibilities.id, createdPermissionIds));
    }
    await sql.end();
  });

  async function seedPermission(): Promise<string> {
    const permissionId = randomUUID();
    createdPermissionIds.push(permissionId);
    await db.insert(reviewEligibilities).values({
      id: permissionId,
      userId,
      productId,
      orderId: `order-${permissionId}`,
      provider: 'order',
      orderLineId: `line-${permissionId}`,
      orderLineAmount: 20000,
      expiresAt: new Date('2261-01-01T00:00:00.000Z'),
    });
    return permissionId;
  }

  /**
   * `reviews.service.ts:create` 가 자격에 대해 하는 일만 떼어낸 것 — 소비 판정과 리뷰 생성이
   * 한 트랜잭션이라는 구조를 그대로 둔다. 배리어는 «소비 직전»에 선다.
   */
  async function consumeAndCreateReview(permissionId: string, barrier: () => Promise<void>): Promise<string> {
    return db.transaction(async (tx) => {
      await barrier();

      const eligibility = await service.consume({ permissionId, userId, productId }, tx as unknown as UgcTx);

      const [review] = await tx
        .insert(reviews)
        .values({
          userId,
          productId,
          rating: 5,
          content: '동시 요청 재현용 리뷰',
          reviewPermissionId: eligibility.id,
        })
        .returning({ id: reviews.id });

      await service.linkConsumedReview(eligibility.id, review.id, tx as unknown as UgcTx);

      return review.id;
    });
  }

  /** 두 트랜잭션이 «둘 다» 소비 직전에 도달한 뒤에야 풀리는 배리어. */
  function makeBarrier(parties: number): () => Promise<void> {
    let arrived = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return async () => {
      arrived += 1;
      if (arrived >= parties) release();
      await gate;
    };
  }

  async function reviewCountFor(permissionId: string): Promise<number> {
    const [row] = await db
      .select({ count: raw<number>`count(*)::int` })
      .from(reviews)
      .where(eq(reviews.reviewPermissionId, permissionId));
    return row.count;
  }

  it('겹친 두 요청 중 하나만 리뷰를 만들고, 다른 하나는 거절된다', async () => {
    const permissionId = await seedPermission();
    const barrier = makeBarrier(2);

    const settled = await Promise.allSettled([
      consumeAndCreateReview(permissionId, barrier),
      consumeAndCreateReview(permissionId, barrier),
    ]);

    const fulfilled = settled.filter((r) => r.status === 'fulfilled');
    const rejected = settled.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      message: '리뷰 작성 자격이 없습니다.',
    });

    // 🔴 판정은 «부수효과»로 한다 — 메서드가 던졌다는 사실이 아니라 남은 행으로.
    expect(await reviewCountFor(permissionId)).toBe(1);
  });

  it('소비된 자격은 consumed_by_review_id 가 실제로 만들어진 리뷰를 가리킨다', async () => {
    const permissionId = await seedPermission();
    const reviewId = await consumeAndCreateReview(permissionId, async () => {});

    const [row] = await db
      .select({
        consumedAt: reviewEligibilities.consumedAt,
        consumedByReviewId: reviewEligibilities.consumedByReviewId,
      })
      .from(reviewEligibilities)
      .where(eq(reviewEligibilities.id, permissionId));

    expect(row.consumedAt).not.toBeNull();
    expect(row.consumedByReviewId).toBe(reviewId);
  });

  it('이미 소비된 자격으로는 두 번째 리뷰를 쓸 수 없다', async () => {
    const permissionId = await seedPermission();
    await consumeAndCreateReview(permissionId, async () => {});

    await expect(consumeAndCreateReview(permissionId, async () => {})).rejects.toMatchObject({
      message: '리뷰 작성 자격이 없습니다.',
    });
    expect(await reviewCountFor(permissionId)).toBe(1);
  });

  it('회수된 자격으로는 리뷰를 쓸 수 없다', async () => {
    const permissionId = await seedPermission();
    await db
      .update(reviewEligibilities)
      .set({ revokedAt: new Date(), revokeReason: 'ORDER_CANCELED' })
      .where(eq(reviewEligibilities.id, permissionId));

    await expect(consumeAndCreateReview(permissionId, async () => {})).rejects.toMatchObject({
      message: '리뷰 작성 자격이 없습니다.',
    });
    expect(await reviewCountFor(permissionId)).toBe(0);
  });
});
