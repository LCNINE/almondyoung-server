import { FulfillmentsService } from './fulfillments.service';

describe('FulfillmentsService.list 합포장 표시 격리', () => {
  function makeService(failOnCall: number) {
    let calls = 0;
    const query = () => {
      calls += 1;

      const failing = calls === failOnCall;
      const chain: Record<string, unknown> = {};

      for (const name of ['from', 'innerJoin', 'leftJoin', 'where', 'limit', 'offset', 'orderBy']) {
        chain[name] = jest.fn(() => chain);
      }

      chain.then = (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
        failing
          ? Promise.reject(new Error('label query failed')).then(resolve, reject)
          : Promise.resolve(calls === 1 ? [{ value: 1 }] : calls === 2 ? [row] : []).then(resolve);

      return chain;
    };

    const row = { id: 'fo-1', salesOrderId: null, warehouseId: null };
    const service: any = Object.create(FulfillmentsService.prototype);

    service.db = { db: { select: jest.fn(query) } };
    service.logger = { warn: jest.fn() };

    return service;
  }

  it('합포장 조회가 실패해도 목록은 응답하고 consolidation 은 null 이다', async () => {
    const service = makeService(3);

    const result = await service.list({ limit: 20, offset: 0 });

    expect(result.total).toBe(1);
    expect(result.data[0]).toMatchObject({ id: 'fo-1', consolidation: null });
    expect(service.logger.warn).toHaveBeenCalledTimes(1);
  });
});
