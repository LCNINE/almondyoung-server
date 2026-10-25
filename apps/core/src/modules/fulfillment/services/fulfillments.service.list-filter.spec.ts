import * as drizzle from 'drizzle-orm';

import { wmsTables } from '../../inventory/schema/inventory.schema';
import { FulfillmentsService } from './fulfillments.service';

jest.mock('drizzle-orm', () => {
  const actual = jest.requireActual('drizzle-orm');
  return { ...actual, eq: jest.fn(actual.eq) };
});

describe('FulfillmentsService.list — 쿼리 문자열 필터 좁히기', () => {
  const eqSpy = drizzle.eq as unknown as jest.Mock;

  function makeService() {
    const chain: Record<string, jest.Mock> = {};
    for (const name of ['select', 'from', 'where', 'limit', 'offset']) chain[name] = jest.fn(() => chain);
    chain.orderBy = jest.fn(async () => []);
    // count 쿼리는 where 에서 끝난다 — 첫 where 는 배열을, 둘째부터는 체인을 돌려준다.
    chain.where.mockImplementationOnce(async () => [{ value: 0 }]);
    const service = Object.create(FulfillmentsService.prototype) as FulfillmentsService;
    (service as unknown as { db: { db: unknown } }).db = { db: chain };
    return service;
  }

  const modeCalls = () => eqSpy.mock.calls.filter(([column]) => column === wmsTables.fulfillmentOrders.fulfillmentMode);

  beforeEach(() => eqSpy.mockClear());

  it('enum 밖 fulfillmentMode(옛 drop_ship 포함)는 쿼리에 닿지 않는다', async () => {
    await makeService().list({ limit: 20, offset: 0, fulfillmentMode: 'drop_ship' });
    expect(modeCalls()).toHaveLength(0);
  });

  it('enum 안 fulfillmentMode 는 필터로 걸린다', async () => {
    await makeService().list({ limit: 20, offset: 0, fulfillmentMode: '3pl' });
    expect(modeCalls()).toEqual([[wmsTables.fulfillmentOrders.fulfillmentMode, '3pl']]);
  });
});
