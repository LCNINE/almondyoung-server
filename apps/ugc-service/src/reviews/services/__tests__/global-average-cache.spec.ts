import { ReviewsService } from '../reviews.service';

/**
 * 베이지안 사전평균(전체 활성 리뷰 평균)은 `reviews` 전체를 Seq Scan 하는 쿼리였고
 * 리뷰를 쓸 때마다 불렸다. TTL 캐시로 그 쿼리를 «쓰기 경로에서» 떼어 낸 것을 못 박는다.
 *
 * 상품 단위 집계는 캐시하지 않는다 — 화면이 바로 읽는 값이라 늦으면 안 된다.
 * 그래서 「전체 쿼리는 한 번, 상품 쿼리는 매번」이 이 스펙의 판정이다.
 */
describe('전역 평균은 TTL 로 캐시하고 상품 집계는 매번 계산한다', () => {
  const PRODUCT_ID = 'prod-1';

  /** 상품별 집계는 groupBy 로, 전역 집계는 groupBy 없이 끝난다 — 그 차이로 둘을 센다. */
  function makeTx() {
    const calls = { product: 0, global: 0 };

    const tx = {
      select: () => {
        let grouped = false;
        const query: Record<string, unknown> = {};
        const chain = () => query;
        Object.assign(query, {
          from: chain,
          where: chain,
          groupBy: () => {
            grouped = true;
            calls.product += 1;
            return Promise.resolve([{ rating: 5, count: 2 }]);
          },
          then: (resolve: (rows: unknown[]) => unknown) => {
            if (!grouped) calls.global += 1;
            return Promise.resolve([{ reviewCount: 100, ratingSum: 400 }]).then(resolve);
          },
        });
        return query;
      },
    };

    return { tx, calls };
  }

  function makeService(ttlMs?: number) {
    const configService = {
      get: (key: string) => (key === 'REVIEW_GLOBAL_AVERAGE_TTL_MS' ? ttlMs : undefined),
    };

    return new ReviewsService({} as never, {} as never, {} as never, {} as never, {} as never, configService as never);
  }

  /** `aggregateReviewStats` 는 private 이므로 공개 진입점 대신 그 자리를 직접 부른다. */
  function aggregate(service: ReviewsService, tx: unknown) {
    return (
      service as unknown as { aggregateReviewStats(productId: string, tx: unknown): Promise<unknown> }
    ).aggregateReviewStats(PRODUCT_ID, tx);
  }

  it('두 번째 호출은 전역 쿼리를 다시 부르지 않는다', async () => {
    const service = makeService();
    const { tx, calls } = makeTx();

    await aggregate(service, tx);
    await aggregate(service, tx);
    await aggregate(service, tx);

    expect(calls.global).toBe(1);
    expect(calls.product).toBe(3);
  });

  it('TTL 이 0 이면 매번 다시 계산한다 — 캐시를 끌 수 있어야 한다', async () => {
    const service = makeService(0);
    const { tx, calls } = makeTx();

    await aggregate(service, tx);
    await aggregate(service, tx);

    expect(calls.global).toBe(2);
  });

  it('캐시를 비우면 다시 계산한다 — 테스트가 프로세스 상태를 물려받지 않는다', async () => {
    const service = makeService();
    const { tx, calls } = makeTx();

    await aggregate(service, tx);
    service.resetGlobalAverageCache();
    await aggregate(service, tx);

    expect(calls.global).toBe(2);
  });

  it('캐시된 사전평균이 베이지안 점수에 그대로 쓰인다 — 값이 바뀌지 않는다', async () => {
    const service = makeService();
    const { tx } = makeTx();

    const first = await aggregate(service, tx);
    const second = await aggregate(service, tx);

    expect(second).toEqual(first);
  });
});
