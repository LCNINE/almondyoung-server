import { BadRequestException } from '@nestjs/common';
import { BadRequestError } from '@app/shared';
import { ReviewsService } from '../reviews.service';
import { ADMIN_MANUAL_SOURCE_SYSTEM } from '../../../source-system';

const REVIEW_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID = '33333333-3333-4333-8333-333333333333';
const MEDIA = ['44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555'];

type Row = Record<string, unknown>;

/**
 * 리뷰 insert 는 행을 돌려주고, 미디어 insert(배열)는 모으기만 한다.
 * select 는 커밋 후 통계 집계용이다 — 상품 집계(groupBy)와 전체 평균 둘 다 받는다.
 */
function makeService() {
  const reviewRows: Row[] = [];
  const mediaRows: Row[][] = [];

  const tx = {
    insert: () => ({
      values: (values: Row | Row[]) => {
        if (Array.isArray(values)) {
          mediaRows.push(values);
          return Promise.resolve();
        }
        reviewRows.push(values);
        return { returning: () => Promise.resolve([{ id: REVIEW_ID, ...values }]) };
      },
    }),
    select: () => ({
      from: () => ({
        where: () =>
          Object.assign(Promise.resolve([{ reviewCount: 1, ratingSum: 5 }]), {
            groupBy: () => Promise.resolve([{ rating: 5, count: 1 }]),
          }),
      }),
    }),
  };

  const permissionService = { consume: jest.fn(), linkConsumedReview: jest.fn() };
  const rewardGrantService = { evaluateForNewReview: jest.fn(), recordSkippedForNewReview: jest.fn() };
  const rewardPublisher = { enqueueEarnPointsCommand: jest.fn() };
  const statsPublisher = { publishProductReviewStatsChanged: jest.fn().mockResolvedValue(undefined) };

  const service = new ReviewsService(
    { db: { transaction: (fn: (t: never) => unknown) => fn(tx as never) } } as never,
    permissionService as never,
    rewardGrantService as never,
    rewardPublisher as never,
    statsPublisher as never,
    { get: () => undefined } as never,
  );

  return { service, tx, reviewRows, mediaRows, permissionService, rewardGrantService, rewardPublisher, statsPublisher };
}

const dto = {
  productId: PRODUCT_ID,
  authorName: '홍길동',
  writtenAt: '2026-09-01T00:00:00+09:00',
  rating: 5,
  content: '향이 좋아요.',
  mediaFileIds: MEDIA,
};

const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

describe('ReviewsService.createByAdmin — 관리자 수기 작성은 이관분과 같은 모양이다', () => {
  it('회원·권한 없이, 출처·작성자명·원 작성일·입력자를 채워 넣는다', async () => {
    const { service, reviewRows } = makeService();

    const created = await service.createByAdmin(ADMIN_ID, dto);

    expect(reviewRows).toHaveLength(1);
    expect(reviewRows[0]).toEqual(
      expect.objectContaining({
        userId: null,
        reviewPermissionId: null,
        productId: PRODUCT_ID,
        rating: 5,
        content: '향이 좋아요.',
        sourceSystem: ADMIN_MANUAL_SOURCE_SYSTEM,
        legacyAuthorName: '홍길동',
        createdByAdminUserId: ADMIN_ID,
        createdAt: new Date('2026-08-31T15:00:00.000Z'),
      }),
    );
    expect(reviewRows[0].legacyImportedAt).toBeInstanceOf(Date);
    expect(created).toEqual(
      expect.objectContaining({ id: REVIEW_ID, permission: null, mediaFileIds: MEDIA, adminComment: null }),
    );
  });

  it('미디어를 받은 순서대로 넣는다', async () => {
    const { service, mediaRows } = makeService();

    await service.createByAdmin(ADMIN_ID, dto);

    expect(mediaRows).toEqual([
      [
        { reviewId: REVIEW_ID, fileId: MEDIA[0], order: 0 },
        { reviewId: REVIEW_ID, fileId: MEDIA[1], order: 1 },
      ],
    ]);
  });

  it('작성 권한도 보상도 건드리지 않는다 — 줄 회원이 없다', async () => {
    const { service, permissionService, rewardGrantService, rewardPublisher } = makeService();

    await service.createByAdmin(ADMIN_ID, dto);

    expect(permissionService.consume).not.toHaveBeenCalled();
    expect(permissionService.linkConsumedReview).not.toHaveBeenCalled();
    expect(rewardGrantService.evaluateForNewReview).not.toHaveBeenCalled();
    expect(rewardGrantService.recordSkippedForNewReview).not.toHaveBeenCalled();
    expect(rewardPublisher.enqueueEarnPointsCommand).not.toHaveBeenCalled();
  });

  it('미래 작성 시각은 넣기 전에 거절한다', async () => {
    const { service, reviewRows } = makeService();
    const future = new Date(Date.now() + 60_000).toISOString();

    await expect(service.createByAdmin(ADMIN_ID, { ...dto, writtenAt: future })).rejects.toBeInstanceOf(
      BadRequestError,
    );
    expect(reviewRows).toHaveLength(0);
  });

  it('같은 미디어를 두 번 붙이면 넣기 전에 거절한다', async () => {
    const { service, reviewRows } = makeService();

    await expect(
      service.createByAdmin(ADMIN_ID, { ...dto, mediaFileIds: [MEDIA[0], MEDIA[0]] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(reviewRows).toHaveLength(0);
  });

  it('바깥 트랜잭션이 없으면 커밋 뒤 상품 평점 통계를 발행한다', async () => {
    const { service, statsPublisher } = makeService();

    await service.createByAdmin(ADMIN_ID, dto);
    await flushAsync();

    expect(statsPublisher.publishProductReviewStatsChanged).toHaveBeenCalledWith(
      expect.objectContaining({ productId: PRODUCT_ID, reviewCount: 1 }),
    );
  });

  it('바깥 트랜잭션 안이면 발행을 호출자에게 맡긴다', async () => {
    const { service, tx, statsPublisher } = makeService();

    await service.createByAdmin(ADMIN_ID, dto, tx as never);
    await flushAsync();

    expect(statsPublisher.publishProductReviewStatsChanged).not.toHaveBeenCalled();
  });
});
