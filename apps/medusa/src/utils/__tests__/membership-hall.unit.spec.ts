import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import {
  categoryIdsFromMpaths,
  loadMembershipHallRows,
  parseMembershipHallQuery,
  selectMembershipHall,
  sortMembershipHallRows,
  type MembershipHallRow,
} from '../membership-hall';

const row = (over: Partial<MembershipHallRow> & { id: string }): MembershipHallRow => ({
  createdAt: '2026-10-01T00:00:00.000Z',
  salesCount: 0,
  reviewCount: 0,
  rate: 0,
  inSale: false,
  inDiscount: true,
  categoryIds: [],
  ...over,
});

const query = parseMembershipHallQuery({});
const roots = [
  { id: 'root_tattoo', handle: 'tattoo' },
  { id: 'root_nail', handle: 'nail' },
  { id: 'root_hair', handle: 'hair' },
];

describe('parseMembershipHallQuery', () => {
  it('모르는 값은 기본값으로 돌린다', () => {
    expect(parseMembershipHallQuery({ tab: 'x', sort: 'y', limit: '-1', offset: 'abc', category: ' ' })).toEqual({
      tab: 'all',
      sort: 'sales',
      category: null,
      limit: 20,
      offset: 0,
    });
  });

  it('limit 은 100 을 넘지 않는다', () => {
    expect(parseMembershipHallQuery({ tab: 'sale', sort: 'newest', limit: '500', offset: '40', category: 'nail' })).toEqual({
      tab: 'sale',
      sort: 'newest',
      category: 'nail',
      limit: 100,
      offset: 40,
    });
  });
});

describe('sortMembershipHallRows', () => {
  const rows = [
    row({ id: 'a', salesCount: 10, reviewCount: 1, rate: 0.1, createdAt: '2026-01-01T00:00:00.000Z' }),
    row({ id: 'b', salesCount: 10, reviewCount: 5, rate: 0.3, createdAt: '2026-02-01T00:00:00.000Z' }),
    row({ id: 'c', salesCount: 50, reviewCount: 0, rate: 0.3, createdAt: '2026-03-01T00:00:00.000Z' }),
  ];

  it('판매량순 동률은 리뷰 수로 가른다', () => {
    expect(sortMembershipHallRows(rows, 'sales').map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('할인율순 동률은 판매량순으로 가른다', () => {
    expect(sortMembershipHallRows(rows, 'discount').map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('최신순', () => {
    expect(sortMembershipHallRows(rows, 'newest').map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('selectMembershipHall', () => {
  const rows = [
    row({ id: 'sale1', inSale: true, inDiscount: false, salesCount: 5, categoryIds: ['root_tattoo', 'leaf_1'] }),
    row({ id: 'both', inSale: true, inDiscount: true, salesCount: 9, categoryIds: ['root_nail'] }),
    row({ id: 'disc1', salesCount: 1, categoryIds: ['root_nail', 'leaf_2'] }),
  ];

  it('탭마다 개수를 세고, 전체는 합집합이다', () => {
    const result = selectMembershipHall(rows, query, null, roots);

    expect(result.counts).toEqual({ all: 3, sale: 2, discount: 2 });
    expect(result.productIds).toEqual(['both', 'sale1', 'disc1']);
    expect(result.hasMembershipSale).toBe(true);
  });

  it('분야 칩은 지금 탭 기준이고 0개 분야는 뺀다', () => {
    const result = selectMembershipHall(rows, { ...query, tab: 'discount' }, null, roots);

    expect(result.categories).toEqual([{ id: 'root_nail', handle: 'nail', count: 2 }]);
  });

  it('분야는 자손 카테고리까지 포함해 거른다', () => {
    const result = selectMembershipHall(rows, query, 'leaf_2', roots);

    expect(result.productIds).toEqual(['disc1']);
    expect(result.total).toBe(1);
  });

  it('없는 분야(빈 id)는 결과가 빈다', () => {
    expect(selectMembershipHall(rows, query, '', roots).total).toBe(0);
  });

  it('페이지를 자른다', () => {
    const result = selectMembershipHall(rows, { ...query, limit: 1, offset: 1 }, null, roots);

    expect(result.productIds).toEqual(['sale1']);
    expect(result.total).toBe(3);
  });

  it('특가 상품이 없으면 hasMembershipSale 이 false 다', () => {
    expect(selectMembershipHall([rows[2]], query, null, roots).hasMembershipSale).toBe(false);
  });
});

describe('categoryIdsFromMpaths', () => {
  it('조상 id 를 중복 없이 편다', () => {
    expect(categoryIdsFromMpaths(['r.a.b', 'r.c'])).toEqual(['r', 'a', 'b', 'c']);
  });
});

describe('loadMembershipHallRows', () => {
  function makeContainer(rows: unknown[]) {
    const calls: Array<{ sql: string; bindings: unknown[] }> = [];
    const knex = {
      raw: jest.fn((sql: string, bindings: unknown[] = []) => {
        calls.push({ sql, bindings });

        return Promise.resolve({ rows });
      }),
    };
    const container = { resolve: (key: string) => (key === ContainerRegistrationKeys.PG_CONNECTION ? knex : undefined) };

    return { container: container as never, calls };
  }

  it('진행 중 특가가 없으면 세일 placeholder 없이 상시 멤버십 리스트만 본다', async () => {
    const { container, calls } = makeContainer([]);

    await loadMembershipHallRows(container, { saleListIds: [], saleVariantIds: [], excludeMembersOnly: true });

    expect(calls[0].bindings).toEqual(['Membership Prices']);
    expect(calls[0].sql).toContain("isVisibleToMembersOnly");
    expect(calls[0].sql).toContain('m.amount < b.amount');
  });

  it('세일 리스트·옵션마다 placeholder 를 하나씩 만들고, 회원이면 회원 전용 상품을 남긴다', async () => {
    const { container, calls } = makeContainer([
      {
        id: 'prod_1',
        created_at: new Date('2026-10-01T00:00:00Z'),
        sales_count: '3',
        review_count: 2,
        rate: '0.25',
        in_sale: true,
        in_discount: false,
        mpaths: ['root.leaf'],
      },
    ]);

    const rows = await loadMembershipHallRows(container, {
      saleListIds: ['pl_1', 'pl_2'],
      saleVariantIds: ['v1'],
      excludeMembersOnly: false,
    });

    expect(calls[0].sql).toContain('pr.price_list_id in (?,?)');
    expect(calls[0].sql).toContain('pvps.variant_id in (?)');
    expect(calls[0].sql).not.toContain('isVisibleToMembersOnly');
    expect(calls[0].bindings).toEqual(['Membership Prices', 'pl_1', 'pl_2', 'v1']);
    expect(rows).toEqual([
      {
        id: 'prod_1',
        createdAt: '2026-10-01T00:00:00.000Z',
        salesCount: 3,
        reviewCount: 2,
        rate: 0.25,
        inSale: true,
        inDiscount: false,
        categoryIds: ['root', 'leaf'],
      },
    ]);
  });
});
