import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { listActiveTimeSales, listProductsInPriceLists } from '../time-sale';
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

describe('listActiveTimeSales', () => {
  it('상시 리스트를 거르려고 기간이 설정된 sale price list 만 고른다', async () => {
    const { container, calls } = makeContainer(() => []);

    await listActiveTimeSales(container);

    const sql = calls[0].sql;
    expect(sql).toContain("pl.type = 'sale'");
    expect(sql).toContain("pl.status = 'active'");
    // Membership Prices / Tiered Prices 는 두 시각이 모두 null 이라 이 조건에서 빠진다.
    expect(sql).toContain('pl.starts_at is not null or pl.ends_at is not null');
  });

  it('진행 중인 세일이 없으면 빈 배열이고 상품을 조회하지 않는다', async () => {
    const { container, calls } = makeContainer(() => []);

    await expect(listActiveTimeSales(container)).resolves.toEqual([]);
    expect(calls.filter((c) => isProductQuery(c.sql))).toHaveLength(0);
  });

  // 카테고리마다 기간이 다른 세일을 동시에 거는 게 목적이다. 하나로 접으면 늦게 끝나는 세일의
  // 상품에 남의 카운트다운이 붙는다.
  it('제목이 다른 세일은 따로 돌려주고 상품도 각자의 것만 담는다', async () => {
    const { container } = makeContainer(({ sql }) =>
      isListQuery(sql)
        ? [
            listRow({ id: 'plist_a', title: '미용기기 세일', ends_at: new Date('2026-08-29T00:00:00Z') }),
            listRow({ id: 'plist_b', title: '색소 세일', ends_at: new Date('2026-09-05T00:00:00Z') }),
          ]
        : [
            { price_list_id: 'plist_a', id: 'prod_1', handle: 'h1' },
            { price_list_id: 'plist_b', id: 'prod_2', handle: 'h2' },
          ]
    );

    const sales = await listActiveTimeSales(container);

    expect(sales).toHaveLength(2);
    expect(sales[0]).toMatchObject({
      title: '미용기기 세일',
      endsAt: '2026-08-29T00:00:00.000Z',
      productIds: ['prod_1'],
    });
    expect(sales[1]).toMatchObject({
      title: '색소 세일',
      endsAt: '2026-09-05T00:00:00.000Z',
      productIds: ['prod_2'],
    });
  });

  // 「주말 타임세일」처럼 이름을 재사용하면 제목만으로는 갈리지 않는다. 섞이면 늦게 끝나는 세일의
  // 상품에 남의 카운트다운이 붙고 상품 목록도 합쳐진다.
  it('제목이 같아도 시작 시각이 다르면 다른 세일로 가른다', async () => {
    const { container } = makeContainer(({ sql }) =>
      isListQuery(sql)
        ? [
            listRow({
              id: 'plist_1',
              starts_at: new Date('2026-08-28T00:00:00Z'),
              ends_at: new Date('2026-08-29T00:00:00Z'),
            }),
            listRow({
              id: 'plist_2',
              starts_at: new Date('2026-09-04T00:00:00Z'),
              ends_at: new Date('2026-09-05T00:00:00Z'),
            }),
          ]
        : [
            { price_list_id: 'plist_1', id: 'prod_1', handle: 'h1' },
            { price_list_id: 'plist_2', id: 'prod_2', handle: 'h2' },
          ]
    );

    const sales = await listActiveTimeSales(container);

    expect(sales).toHaveLength(2);
    expect(sales[0]).toMatchObject({ endsAt: '2026-08-29T00:00:00.000Z', productIds: ['prod_1'] });
    expect(sales[1]).toMatchObject({ endsAt: '2026-09-05T00:00:00.000Z', productIds: ['prod_2'] });
  });

  // 세일 하나는 price list 둘(일반용·멤버십용)로 저장된다. 묶지 않으면 화면에 같은 세일이 두 번 뜬다.
  it('멤버십용 리스트를 제목 접미사로 일반용과 한 세일로 묶는다', async () => {
    const { container } = makeContainer(({ sql }) =>
      isListQuery(sql)
        ? [
            listRow({ id: 'plist_g', title: '8월 마감 세일' }),
            listRow({ id: 'plist_m', title: '8월 마감 세일 (멤버십)', is_membership_only: true }),
          ]
        : [
            { price_list_id: 'plist_g', id: 'prod_1', handle: 'h1' },
            { price_list_id: 'plist_m', id: 'prod_1', handle: 'h1' },
          ]
    );

    const sales = await listActiveTimeSales(container);

    expect(sales).toHaveLength(1);
    expect(sales[0].title).toBe('8월 마감 세일');
    expect(sales[0].priceListIds).toEqual(['plist_g', 'plist_m']);
    // 두 리스트에 같은 상품이 걸려 있어도 목록엔 한 번만 나온다.
    expect(sales[0].productIds).toEqual(['prod_1']);
  });

  it('멤버십용 리스트만 남은 세일은 접미사를 뗀 제목을 쓴다', async () => {
    const { container } = makeContainer(({ sql }) =>
      isListQuery(sql)
        ? [listRow({ id: 'plist_m', title: '8월 마감 세일 (멤버십)', is_membership_only: true })]
        : []
    );

    const [sale] = await listActiveTimeSales(container);

    expect(sale.title).toBe('8월 마감 세일');
  });

  // 짝인 두 리스트는 기간이 같지만, 어긋났다면 "아직 남았다" 를 보고 담은 손님이 정가를 만난다.
  it('한 세일 안에서 종료 시각이 어긋나면 짧은 쪽을 쓴다', async () => {
    const { container } = makeContainer(({ sql }) =>
      isListQuery(sql)
        ? [
            listRow({ id: 'plist_g', title: '8월 마감 세일', ends_at: new Date('2026-09-05T00:00:00Z') }),
            listRow({
              id: 'plist_m',
              title: '8월 마감 세일 (멤버십)',
              is_membership_only: true,
              ends_at: new Date('2026-08-29T00:00:00Z'),
            }),
          ]
        : []
    );

    const [sale] = await listActiveTimeSales(container);

    expect(sale.endsAt).toBe('2026-08-29T00:00:00.000Z');
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
            { price_list_id: 'plist_general', id: 'prod_1', handle: 'h1' },
            { price_list_id: 'plist_general', id: 'prod_2', handle: 'h2' },
            { price_list_id: 'plist_general', id: 'prod_3', handle: 'h3' },
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
