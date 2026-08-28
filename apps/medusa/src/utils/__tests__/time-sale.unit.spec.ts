import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { getActiveTimeSale, listProductsInPriceLists } from '../time-sale';
import timeSaleCacheBoundaryJob from '../../jobs/time-sale-cache-boundary';

type RawCall = { sql: string; bindings: unknown[] };

function makeContainer(handler: (call: RawCall) => unknown[]) {
  const calls: RawCall[] = [];
  const logs: string[] = [];

  const knex = {
    raw: jest.fn((sql: string, bindings: unknown[] = []) => {
      const call = { sql, bindings };
      calls.push(call);
      return Promise.resolve({ rows: handler(call) });
    }),
  };

  const registry: Record<string, unknown> = {
    [ContainerRegistrationKeys.PG_CONNECTION]: knex,
    [ContainerRegistrationKeys.LOGGER]: {
      info: (m: string) => logs.push(m),
      warn: (m: string) => logs.push(m),
      error: (m: string) => logs.push(m),
    },
  };

  return { container: { resolve: (key: string) => registry[key] } as never, calls, logs };
}

const listRow = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'plist_general',
  title: '8월 마감 세일',
  starts_at: new Date('2026-08-28T00:00:00Z'),
  ends_at: new Date('2026-08-30T11:00:00Z'),
  is_membership_only: false,
  ...over,
});

const isListQuery = (sql: string) => sql.includes('from price_list pl');
const isProductQuery = (sql: string) => sql.includes('from price pr');

describe('getActiveTimeSale', () => {
  it('상시 리스트를 거르려고 기간이 설정된 sale price list 만 고른다', async () => {
    const { container, calls } = makeContainer(({ sql }) => (isListQuery(sql) ? [] : []));

    await getActiveTimeSale(container);

    const sql = calls[0].sql;
    expect(sql).toContain("pl.type = 'sale'");
    expect(sql).toContain("pl.status = 'active'");
    // Membership Prices / Tiered Prices 는 두 시각이 모두 null 이라 이 조건에서 빠진다.
    expect(sql).toContain('pl.starts_at is not null or pl.ends_at is not null');
  });

  it('진행 중인 세일이 없으면 null 이고 상품을 조회하지 않는다', async () => {
    const { container, calls } = makeContainer(() => []);

    await expect(getActiveTimeSale(container)).resolves.toBeNull();
    expect(calls.filter((c) => isProductQuery(c.sql))).toHaveLength(0);
  });

  // 겹침은 어드민이 막지만 뚫렸을 때 카운트다운이 실제보다 길게 보이면 "아직 남았다" 를 보고 담은
  // 손님이 정가를 만난다. 짧게 보이는 쪽이 안전하다.
  it('여러 세일이 활성이면 가장 빨리 끝나는 종료 시각을 쓴다', async () => {
    const { container } = makeContainer(({ sql }) =>
      isListQuery(sql)
        ? [
            listRow({ id: 'plist_late', ends_at: new Date('2026-09-05T00:00:00Z') }),
            listRow({ id: 'plist_soon', ends_at: new Date('2026-08-29T00:00:00Z') }),
          ]
        : [{ id: 'prod_1', handle: 'handle-1' }]
    );

    const sale = await getActiveTimeSale(container);

    expect(sale?.endsAt).toBe('2026-08-29T00:00:00.000Z');
    expect(sale?.priceListIds).toEqual(['plist_late', 'plist_soon']);
  });

  it('세일 이름은 멤버십 전용이 아닌 리스트에서 가져온다', async () => {
    const { container } = makeContainer(({ sql }) =>
      isListQuery(sql)
        ? [
            listRow({ id: 'plist_m', title: '멤버십용', is_membership_only: true }),
            listRow({ id: 'plist_g', title: '8월 마감 세일', is_membership_only: false }),
          ]
        : []
    );

    const sale = await getActiveTimeSale(container);

    expect(sale?.title).toBe('8월 마감 세일');
  });
});

describe('listProductsInPriceLists', () => {
  it('빈 목록이면 쿼리하지 않는다', async () => {
    const { container, calls } = makeContainer(() => []);

    await expect(listProductsInPriceLists(container, [])).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });

  // `= any(?)` 로 배열을 넘기면 드라이버가 펼쳐 넣어 문법이 깨진다. placeholder 개수가 id 수와
  // 같아야 한다.
  it('price list id 마다 placeholder 를 하나씩 만든다', async () => {
    const { container, calls } = makeContainer(() => []);

    await listProductsInPriceLists(container, ['a', 'b', 'c']);

    expect(calls[0].sql).toContain('pr.price_list_id in (?,?,?)');
    expect(calls[0].bindings).toEqual(['a', 'b', 'c']);
  });
});

describe('time-sale-cache-boundary job', () => {
  const OLD_URL = process.env.STOREFRONT_REVALIDATE_URL;
  const OLD_SECRET = process.env.STOREFRONT_REVALIDATE_SECRET;

  beforeEach(() => {
    process.env.STOREFRONT_REVALIDATE_URL = 'https://storefront.test/api/revalidate';
    process.env.STOREFRONT_REVALIDATE_SECRET = 'secret';
    global.fetch = jest.fn(async () => ({ ok: true, status: 200 })) as never;
  });
  afterAll(() => {
    process.env.STOREFRONT_REVALIDATE_URL = OLD_URL;
    process.env.STOREFRONT_REVALIDATE_SECRET = OLD_SECRET;
  });

  it('경계를 지난 세일이 없으면 아무것도 호출하지 않는다', async () => {
    const { container } = makeContainer(() => []);

    await timeSaleCacheBoundaryJob(container);

    expect(global.fetch).not.toHaveBeenCalled();
  });

  // 라우트는 handle 이 실렸을 때만 전역 목록 태그를 비운다 — 상품마다 실으면 캐시가 데워질 틈이 없다.
  it('첫 상품만 handle 로 싣고 나머지는 태그로 지운다', async () => {
    const { container } = makeContainer(({ sql }) =>
      isListQuery(sql)
        ? [listRow()]
        : [
            { id: 'prod_1', handle: 'h1' },
            { id: 'prod_2', handle: 'h2' },
            { id: 'prod_3', handle: 'h3' },
          ]
    );

    await timeSaleCacheBoundaryJob(container);

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      handle: 'h1',
      tags: ['time-sale', 'product-h2', 'product-h3'],
    });
    expect(init.headers['x-revalidate-secret']).toBe('secret');
  });

  it('종료된 세일도 잡아야 하므로 경계 조회에 활성 기간 조건을 걸지 않는다', async () => {
    const { container, calls } = makeContainer(({ sql }) => (isListQuery(sql) ? [] : []));

    await timeSaleCacheBoundaryJob(container);

    expect(calls[0].sql).not.toContain('pl.ends_at >= now()');
  });

  // 시작만 앞당겨 친다. 세일 시작 순간에 전역 목록 캐시를 버리면 미스가 한꺼번에 Medusa 로 몰려
  // CPU 가 포화된다 — 미리 비워 워밍을 분산시킨다. 종료를 앞당기면 세일 중에 정가가 보인다.
  it('시작만 예열 오프셋을 쓰고 종료는 경계 그대로 본다', async () => {
    const { container, calls } = makeContainer(({ sql }) => (isListQuery(sql) ? [] : []));

    await timeSaleCacheBoundaryJob(container);

    const { sql, bindings } = calls[0];
    expect(sql).toContain("pl.starts_at <= now() + (?::int * interval '1 second')");
    expect(sql).toContain('pl.ends_at <= now()');
    expect(sql).not.toContain("pl.ends_at <= now() +");
    // [prewarm, window, prewarm, window] — 예열이 창보다 커야 같은 시작이 두 번 안 잡힌다.
    expect(bindings).toEqual([120, 70, 120, 70]);
    expect(bindings[0]).toBeGreaterThan(bindings[1] as number);
  });

  it('무효화 주소가 없으면 조용히 넘어가지 않고 경고를 남긴다', async () => {
    delete process.env.STOREFRONT_REVALIDATE_URL;
    const { container, logs } = makeContainer(({ sql }) => (isListQuery(sql) ? [listRow()] : []));

    await timeSaleCacheBoundaryJob(container);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(logs.some((log) => log.includes('캐시를 비우지 못했다'))).toBe(true);
  });
});
