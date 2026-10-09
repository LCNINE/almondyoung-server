import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import type { MedusaContainer } from '@medusajs/framework/types';
import type { TimeSaleRecord } from '../modules/time-sale/service';

// ── 경계 크론용 (price list 기준) ──────────────────────────────────────────────
// 가격 엔진은 price list 의 starts_at/ends_at/status 를 읽는다. 워크플로가 time_sale 값을 리스트에 맞춰
// 두므로, «언제 화면이 바뀌어야 하나» 는 리스트로 보는 게 정확하다.
//
// 일반용/멤버십용 구분은 구조로 한다 — 룰이 customer.groups.id 면 멤버십 전용이다.

export type TimeSaleList = {
  id: string;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  isMembershipOnly: boolean;
};

const TIME_SALE_LIST_COLUMNS = `
  pl.id,
  pl.title,
  pl.starts_at,
  pl.ends_at,
  exists (
    select 1 from price_list_rule plr
    where plr.price_list_id = pl.id
      and plr.deleted_at is null
      and plr.attribute = 'customer.groups.id'
  ) as is_membership_only
`;

const TIME_SALE_BASE_WHERE = `
  pl.deleted_at is null
  and pl.status = 'active'
  and pl.type = 'sale'
  and (pl.starts_at is not null or pl.ends_at is not null)
`;

// 경계를 지났거나(종료) 곧 지날(시작) 리스트. 종료된 리스트도 잡아야 하므로 활성 창 조건을 걸지 않는다.
//
// 시작 쪽만 prewarmSeconds 만큼 앞당겨 본다. 전역 목록 캐시를 비우는 순간 캐시 미스가 한꺼번에
// Medusa 로 몰리는데, 세일 시작은 트래픽이 몰리는 시점이라 그 둘이 겹치면 CPU 가 포화된다
// (이 서비스는 Medusa CPU 포화로 결제 콜백이 타임아웃된 전례가 있다). 미리 비워두면 워밍이
// 분산되고, 그 사이 방문자는 아직 정가를 본다 — 손님에게 손해가 아니다.
// 종료 쪽은 반대다. 앞당기면 세일 중인데 정가가 보이므로 정확히 경계에서 친다.
const CROSSED_BOUNDARY_SQL = `
  select ${TIME_SALE_LIST_COLUMNS}
  from price_list pl
  where ${TIME_SALE_BASE_WHERE}
    and (
      (
        pl.starts_at is not null
        and pl.starts_at > now() + ((?::int - ?::int) * interval '1 second')
        and pl.starts_at <= now() + (?::int * interval '1 second')
      )
      or
      (
        pl.ends_at is not null
        and pl.ends_at > now() - (?::int * interval '1 second')
        and pl.ends_at <= now()
      )
    )
`;

type ListRow = {
  id: string;
  title: string;
  starts_at: Date | string | null;
  ends_at: Date | string | null;
  is_membership_only: boolean;
};

type ProductRow = { id: string; handle: string; price_list_id: string };

const toIso = (value: Date | string | null): string | null => {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
};

const toLists = (rows: ListRow[]): TimeSaleList[] =>
  rows.map((row) => ({
    id: row.id,
    title: row.title,
    startsAt: toIso(row.starts_at),
    endsAt: toIso(row.ends_at),
    isMembershipOnly: row.is_membership_only,
  }));

/**
 * price list 에 가격이 걸린 판매중 상품. 세일 종료 뒤에도 가격 행은 남으므로 종료된 리스트에도 쓸 수 있다.
 *
 * 어느 리스트에서 나왔는지(`price_list_id`)를 같이 준다 — 세일이 여럿이면 그걸로 갈라야 한다.
 * 한 상품이 두 리스트에 걸려 있으면 행도 둘이니, 상품 단위로 쓰는 쪽은 중복을 걷어내야 한다.
 */
export async function listProductsInPriceLists(
  container: MedusaContainer,
  priceListIds: string[]
): Promise<ProductRow[]> {
  if (priceListIds.length === 0) return [];

  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  // `= any(?)` 는 드라이버가 배열을 펼쳐 넣어 문법이 깨지는 사례가 있어 placeholder 를 직접 만든다.
  const placeholders = priceListIds.map(() => '?').join(',');
  // 정렬 기준은 판매순 → 리뷰순 → 최신순. 홈 타임세일이 이 순서를 그대로 쓰므로 여기서 한 번만
  // 정한다 — 스토어프론트가 다시 정렬하면 정렬에 필요한 판매량·리뷰수를 상품 응답에 또 실어야 한다.
  // psi 는 left join 이다: 색인이 아직 없는 신상품을 목록에서 통째로 떨어뜨리면 안 된다.
  const result = await knex.raw(
    `
      select pr.price_list_id, p.id, p.handle
      from price pr
      join product_variant_price_set pvps on pvps.price_set_id = pr.price_set_id
      join product_variant pv on pv.id = pvps.variant_id and pv.deleted_at is null
      join product p on p.id = pv.product_id and p.deleted_at is null
      left join product_sort_index psi
        on psi.product_id = p.id and psi.deleted_at is null and psi.currency_code = 'krw'
      where pr.price_list_id in (${placeholders})
        and pr.deleted_at is null
        and p.status = 'published'
      group by pr.price_list_id, p.id, p.handle, psi.sales_count, psi.review_count, p.created_at
      order by
        coalesce(psi.sales_count, 0) desc,
        coalesce(psi.review_count, 0) desc,
        p.created_at desc
    `,
    priceListIds
  );

  return (result.rows ?? []) as ProductRow[];
}

/**
 * 경계를 막 지난(종료) 또는 prewarmSeconds 뒤에 지날(시작) 타임세일 리스트.
 *
 * prewarmSeconds 는 windowSeconds 이상이어야 한다 — 작으면 같은 세일의 시작이 예열 때 한 번,
 * 실제 경계 때 또 한 번 잡힌다. 무효화는 멱등이라 깨지진 않지만 캐시를 두 번 버린다.
 */
export async function listTimeSalesCrossingBoundary(
  container: MedusaContainer,
  windowSeconds: number,
  prewarmSeconds: number
): Promise<TimeSaleList[]> {
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const result = await knex.raw(CROSSED_BOUNDARY_SQL, [
    prewarmSeconds,
    windowSeconds,
    prewarmSeconds,
    windowSeconds,
  ]);
  return toLists((result.rows ?? []) as ListRow[]);
}

// ── 세일 단위 (time_sale 기준) ─────────────────────────────────────────────────

export type AdminTimeSaleDto = {
  id: string;
  title: string;
  status: 'draft' | 'active';
  startsAt: string;
  endsAt: string;
  productIds: string[];
  /** variant id → 일반용 세일가. */
  generalPrices: Record<string, number>;
  /** variant id → 멤버십용 세일가. */
  membershipPrices: Record<string, number>;
};

type SaleWithLists = TimeSaleRecord & { price_lists: Array<{ id: string }> };

async function loadSales(container: MedusaContainer, filters: Record<string, unknown> = {}): Promise<SaleWithLists[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: 'time_sale',
    fields: ['id', 'title', 'status', 'starts_at', 'ends_at', 'price_lists.id'],
    filters,
  });
  return data as unknown as SaleWithLists[];
}

type PriceRow = { price_list_id: string; amount: string | number; variant_id: string; product_id: string };

async function loadPriceRows(container: MedusaContainer, listIds: string[]) {
  if (listIds.length === 0) return { prices: [] as PriceRow[], membershipListIds: new Set<string>() };
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const placeholders = listIds.map(() => '?').join(',');
  const [{ rows: prices }, { rows: rules }] = await Promise.all([
    knex.raw(
      `select pr.price_list_id, pr.amount, pvps.variant_id, pv.product_id
         from price pr
         join product_variant_price_set pvps on pvps.price_set_id = pr.price_set_id
         join product_variant pv on pv.id = pvps.variant_id and pv.deleted_at is null
        where pr.price_list_id in (${placeholders}) and pr.deleted_at is null`,
      listIds,
    ),
    knex.raw(
      `select distinct price_list_id from price_list_rule
        where price_list_id in (${placeholders}) and deleted_at is null and attribute = 'customer.groups.id'`,
      listIds,
    ),
  ]);
  return {
    prices: prices as PriceRow[],
    membershipListIds: new Set((rules as Array<{ price_list_id: string }>).map((r) => r.price_list_id)),
  };
}

const iso = (value: Date | string) => (value instanceof Date ? value.toISOString() : new Date(value).toISOString());

/**
 * 어드민이 보는 타임세일 — 예약·진행·종료·비공개를 가리지 않는다. 가격을 **variant id 로** 돌려준다:
 * Admin API 로는 price 에서 variant 로 갈 수 없다(그 사이는 `product_variant_price_set` 링크 테이블뿐).
 */
export async function listAdminTimeSales(
  container: MedusaContainer,
  filters: Record<string, unknown> = {},
): Promise<AdminTimeSaleDto[]> {
  const sales = await loadSales(container, filters);
  const { prices, membershipListIds } = await loadPriceRows(
    container,
    sales.flatMap((sale) => sale.price_lists.map((p) => p.id)),
  );

  return sales
    .map((sale) => {
      const listIds = new Set(sale.price_lists.map((p) => p.id));
      const generalPrices: Record<string, number> = {};
      const membershipPrices: Record<string, number> = {};
      const productIds = new Set<string>();
      for (const row of prices) {
        if (!listIds.has(row.price_list_id)) continue;
        const target = membershipListIds.has(row.price_list_id) ? membershipPrices : generalPrices;
        target[row.variant_id] = Number(row.amount);
        productIds.add(row.product_id);
      }
      return {
        id: sale.id,
        title: sale.title,
        status: sale.status,
        startsAt: iso(sale.starts_at),
        endsAt: iso(sale.ends_at),
        productIds: [...productIds],
        generalPrices,
        membershipPrices,
      };
    })
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt));
}

export type StoreTimeSaleDto = {
  id: string;
  startsAt: string;
  endsAt: string;
  priceListIds: string[];
  productIds: string[];
};

export type StoreTimeSaleResponse = {
  timeSales: StoreTimeSaleDto[];
  products: Array<{ id: string; categoryIds: string[] }>;
};

/**
 * 지금 진행 중인 타임세일(active + 기간 안). 종료 빠른 순. **세일 이름은 싣지 않는다** — 운영자가 지은
 * 이름은 내부용이다(2026-10-09 노출 사고).
 *
 * `products` 는 모든 진행 중 세일 상품을 중복 없이, 판매순 → 리뷰순 → 최신순으로 준다. 카테고리 id 를
 * 같이 주는 이유: `/time-sale` 이 상품 수백 개를 다 받지 않고도 카테고리 탭을 만들 수 있게.
 */
export async function listActiveStoreTimeSales(container: MedusaContainer): Promise<StoreTimeSaleResponse> {
  const now = new Date();
  const sales = (await loadSales(container, { status: 'active' }))
    .filter((sale) => new Date(sale.starts_at) <= now && new Date(sale.ends_at) >= now)
    .sort((a, b) => iso(a.ends_at).localeCompare(iso(b.ends_at)));
  if (sales.length === 0) return { timeSales: [], products: [] };

  const listIds = sales.flatMap((sale) => sale.price_lists.map((p) => p.id));
  const rows = await listProductsInPriceLists(container, listIds);

  const productsByList = new Map<string, string[]>();
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const bucket = productsByList.get(row.price_list_id) ?? [];
    bucket.push(row.id);
    productsByList.set(row.price_list_id, bucket);
    if (!seen.has(row.id)) {
      seen.add(row.id);
      ordered.push(row.id);
    }
  }

  const categoryIds = await loadCategoryIds(container, ordered);

  return {
    timeSales: sales.map((sale) => ({
      id: sale.id,
      startsAt: iso(sale.starts_at),
      endsAt: iso(sale.ends_at),
      priceListIds: sale.price_lists.map((p) => p.id),
      productIds: [...new Set(sale.price_lists.flatMap((p) => productsByList.get(p.id) ?? []))],
    })),
    products: ordered.map((id) => ({ id, categoryIds: categoryIds.get(id) ?? [] })),
  };
}

async function loadCategoryIds(container: MedusaContainer, productIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (productIds.length === 0) return map;
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const placeholders = productIds.map(() => '?').join(',');
  const { rows } = await knex.raw(
    `select product_id, product_category_id from product_category_product where product_id in (${placeholders})`,
    productIds,
  );
  for (const row of rows as Array<{ product_id: string; product_category_id: string }>) {
    const bucket = map.get(row.product_id) ?? [];
    bucket.push(row.product_category_id);
    map.set(row.product_id, bucket);
  }
  return map;
}

/** 세일에 걸린 상품 handle — 쓰기 뒤 캐시 무효화용. */
export async function listTimeSaleProductHandles(container: MedusaContainer, priceListIds: string[]): Promise<string[]> {
  return (await listProductsInPriceLists(container, priceListIds)).map((row) => row.handle);
}
