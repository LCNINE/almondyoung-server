import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import type { MedusaContainer } from '@medusajs/framework/types';

export const MEMBERSHIP_HALL_TABS = ['all', 'sale', 'discount'] as const;
export const MEMBERSHIP_HALL_SORTS = ['sales', 'discount', 'newest'] as const;

export type MembershipHallTab = (typeof MEMBERSHIP_HALL_TABS)[number];
export type MembershipHallSort = (typeof MEMBERSHIP_HALL_SORTS)[number];

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export type MembershipHallQuery = {
  tab: MembershipHallTab;
  sort: MembershipHallSort;
  category: string | null;
  limit: number;
  offset: number;
};

export type MembershipHallRow = {
  id: string;
  createdAt: string;
  salesCount: number;
  reviewCount: number;
  /** 0~1. 멤버십가(특가 포함) 기준 기본가 대비 최대 할인율. */
  rate: number;
  inSale: boolean;
  inDiscount: boolean;
  /** 상품이 붙은 카테고리와 그 조상 id 전부. */
  categoryIds: string[];
};

export type MembershipHallRoot = { id: string; handle: string };

export type MembershipHallResponse = {
  total: number;
  limit: number;
  offset: number;
  productIds: string[];
  counts: Record<MembershipHallTab, number>;
  /** 지금 탭에서 상품이 있는 루트 카테고리. 분야 칩용. */
  categories: Array<{ id: string; handle: string; count: number }>;
  hasMembershipSale: boolean;
};

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

const toInt = (value: unknown, fallback: number) => {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

export function parseMembershipHallQuery(query: Record<string, unknown>): MembershipHallQuery {
  const category = typeof query.category === 'string' && query.category.trim() ? query.category.trim() : null;

  return {
    tab: pick(query.tab, MEMBERSHIP_HALL_TABS, 'all'),
    sort: pick(query.sort, MEMBERSHIP_HALL_SORTS, 'sales'),
    category,
    limit: Math.min(Math.max(toInt(query.limit, DEFAULT_LIMIT), 1), MAX_LIMIT),
    offset: toInt(query.offset, 0),
  };
}

const inTab = (row: MembershipHallRow, tab: MembershipHallTab) =>
  tab === 'all' || (tab === 'sale' ? row.inSale : row.inDiscount);

const bySales = (a: MembershipHallRow, b: MembershipHallRow) =>
  b.salesCount - a.salesCount || b.reviewCount - a.reviewCount || b.createdAt.localeCompare(a.createdAt);

const COMPARATORS: Record<MembershipHallSort, (a: MembershipHallRow, b: MembershipHallRow) => number> = {
  sales: bySales,
  discount: (a, b) => b.rate - a.rate || bySales(a, b),
  newest: (a, b) => b.createdAt.localeCompare(a.createdAt) || bySales(a, b),
};

export function sortMembershipHallRows(rows: MembershipHallRow[], sort: MembershipHallSort): MembershipHallRow[] {
  const compare = COMPARATORS[sort];

  return [...rows].sort((a, b) => compare(a, b) || a.id.localeCompare(b.id));
}

/**
 * 탭·분야·정렬·페이지를 적용한다. 분야 칩은 지금 탭 기준(분야 선택 전)으로 세고, 0개 분야는 뺀다.
 * categoryId 가 null 이면 분야 전체, 빈 문자열이면 «없는 분야»라 결과가 비어야 한다.
 */
export function selectMembershipHall(
  rows: MembershipHallRow[],
  query: MembershipHallQuery,
  categoryId: string | null,
  roots: MembershipHallRoot[],
): MembershipHallResponse {
  const tabRows = rows.filter((row) => inTab(row, query.tab));
  const filtered = categoryId === null ? tabRows : tabRows.filter((row) => row.categoryIds.includes(categoryId));
  const sorted = sortMembershipHallRows(filtered, query.sort);

  const categories = roots
    .map((root) => ({ ...root, count: tabRows.filter((row) => row.categoryIds.includes(root.id)).length }))
    .filter((root) => root.count > 0);

  return {
    total: sorted.length,
    limit: query.limit,
    offset: query.offset,
    productIds: sorted.slice(query.offset, query.offset + query.limit).map((row) => row.id),
    counts: {
      all: rows.length,
      sale: rows.filter((row) => row.inSale).length,
      discount: rows.filter((row) => row.inDiscount).length,
    },
    categories,
    hasMembershipSale: rows.some((row) => row.inSale),
  };
}

/** mpath(`루트.자식.자신`) 들을 조상 포함 id 집합으로 편다. */
export const categoryIdsFromMpaths = (mpaths: string[]): string[] => [
  ...new Set(mpaths.flatMap((mpath) => mpath.split('.').filter(Boolean))),
];

// ── DB ────────────────────────────────────────────────────────────────────────

// 상시 멤버십가 리스트. 채널 어댑터가 이 이름으로 만들고(ensurePriceList) 표시가 감시 잡도 같은 이름으로 찾는다.
// 기간이 있는 리스트(타임세일·기간 수량 할인)와 회원 그룹 룰이 없는 리스트는 이름이 같아도 제외한다.
const MEMBERSHIP_PRICE_LIST_TITLE = 'Membership Prices';

type SqlRow = {
  id: string;
  created_at: Date | string;
  sales_count: string | number;
  review_count: string | number;
  rate: string | number | null;
  in_sale: boolean;
  in_discount: boolean;
  mpaths: string[] | null;
};

const iso = (value: Date | string) => (value instanceof Date ? value.toISOString() : new Date(value).toISOString());

/**
 * 멤버십관 후보 상품. 멤버십할인가 = `Membership Prices` 가격이 기본가보다 싼 옵션이 있는 상품
 * (core 의 membership_price 는 NOT NULL 이라 값 유무로는 못 가른다). 멤버십 특가 = 진행 중 세일의
 * 멤버십 전용 옵션이 있는 상품. 결제에 실제로 쓰이는 가격표를 읽으므로 화면과 결제가 어긋나지 않는다.
 */
export async function loadMembershipHallRows(
  container: MedusaContainer,
  params: { saleListIds: string[]; saleVariantIds: string[]; excludeMembersOnly: boolean },
): Promise<MembershipHallRow[]> {
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const hasSale = params.saleListIds.length > 0 && params.saleVariantIds.length > 0;
  const listPlaceholders = params.saleListIds.map(() => '?').join(',');
  const variantPlaceholders = params.saleVariantIds.map(() => '?').join(',');

  // `= any(?)` 는 드라이버가 배열을 펼쳐 넣어 문법이 깨지는 사례가 있어 placeholder 를 직접 만든다.
  const saleCte = hasSale
    ? `
      select pvps.variant_id, min(pr.amount) as amount
      from price pr
      join product_variant_price_set pvps on pvps.price_set_id = pr.price_set_id
      where pr.price_list_id in (${listPlaceholders})
        and pr.deleted_at is null
        and pvps.variant_id in (${variantPlaceholders})
      group by pvps.variant_id
    `
    : `select null::text as variant_id, null::numeric as amount where false`;

  const result = await knex.raw(
    `
      with member as (
        select pvps.variant_id, min(pr.amount) as amount
        from price pr
        join product_variant_price_set pvps on pvps.price_set_id = pr.price_set_id
        join price_list pl on pl.id = pr.price_list_id
        where pl.title = ?
          and pl.deleted_at is null
          and pl.status = 'active'
          and pl.starts_at is null
          and pl.ends_at is null
          and exists (
            select 1 from price_list_rule plr
            where plr.price_list_id = pl.id and plr.deleted_at is null and plr.attribute = 'customer.groups.id'
          )
          and pr.deleted_at is null
          and pr.currency_code = 'krw'
          and pr.min_quantity is null
        group by pvps.variant_id
      ),
      sale as (${saleCte}),
      base as (
        select pvps.variant_id, min(pr.amount) as amount
        from price pr
        join product_variant_price_set pvps on pvps.price_set_id = pr.price_set_id
        where pr.price_list_id is null
          and pr.deleted_at is null
          and pr.currency_code = 'krw'
          and pr.min_quantity is null
          and coalesce(pr.rules_count, 0) = 0
          and pvps.variant_id in (select variant_id from member union select variant_id from sale)
        group by pvps.variant_id
      )
      select
        p.id,
        p.created_at,
        coalesce(psi.sales_count, 0) as sales_count,
        coalesce(psi.review_count, 0) as review_count,
        max(
          case when b.amount > 0
            then (b.amount - least(coalesce(m.amount, b.amount), coalesce(s.amount, b.amount))) / b.amount
            else 0
          end
        ) as rate,
        bool_or(s.variant_id is not null) as in_sale,
        bool_or(m.amount < b.amount) as in_discount,
        array_remove(array_agg(distinct pc.mpath), null) as mpaths
      from product_variant pv
      join product p on p.id = pv.product_id and p.deleted_at is null
      join base b on b.variant_id = pv.id
      left join member m on m.variant_id = pv.id
      left join sale s on s.variant_id = pv.id
      left join product_sort_index psi
        on psi.product_id = p.id and psi.deleted_at is null and psi.currency_code = 'krw'
      left join product_category_product pcp on pcp.product_id = p.id
      left join product_category pc on pc.id = pcp.product_category_id and pc.deleted_at is null
      where pv.deleted_at is null
        and p.status = 'published'
        and (m.amount < b.amount or s.variant_id is not null)
        ${params.excludeMembersOnly ? `and (p.metadata->>'isVisibleToMembersOnly') is distinct from 'true'` : ''}
      group by p.id, p.created_at, psi.sales_count, psi.review_count
    `,
    [MEMBERSHIP_PRICE_LIST_TITLE, ...(hasSale ? [...params.saleListIds, ...params.saleVariantIds] : [])],
  );

  return ((result.rows ?? []) as SqlRow[]).map((row) => ({
    id: row.id,
    createdAt: iso(row.created_at),
    salesCount: Number(row.sales_count),
    reviewCount: Number(row.review_count),
    rate: Number(row.rate ?? 0),
    inSale: row.in_sale === true,
    inDiscount: row.in_discount === true,
    categoryIds: categoryIdsFromMpaths(row.mpaths ?? []),
  }));
}

export async function loadRootCategories(container: MedusaContainer): Promise<MembershipHallRoot[]> {
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const { rows } = await knex.raw(
    `select id, handle from product_category
      where parent_category_id is null and deleted_at is null and is_active = true and is_internal = false
      order by rank, created_at`,
  );

  return rows as MembershipHallRoot[];
}

/** handle 또는 id 로 카테고리 id. 없으면 빈 문자열(결과도 비게 된다). */
export async function resolveCategoryId(container: MedusaContainer, value: string): Promise<string> {
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const { rows } = await knex.raw(
    `select id from product_category where (id = ? or handle = ?) and deleted_at is null limit 1`,
    [value, value],
  );

  return (rows as Array<{ id: string }>)[0]?.id ?? '';
}
