import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import type { MedusaContainer } from '@medusajs/framework/types';

/**
 * 타임세일은 **기간이 설정된 sale price list** 다.
 *
 * price_list 에는 metadata 컬럼이 없어 마커를 심을 자리가 없다. 대신 상시 운영되는 두 리스트
 * (`Membership Prices`, `Tiered Prices - Min N`) 는 starts_at·ends_at 이 둘 다 null 이라,
 * "기간이 있다" 는 조건만으로 타임세일이 갈린다. 이름 접두사 규칙보다 깨질 구석이 적다.
 *
 * 일반용/멤버십용 구분도 구조로 한다 — 룰이 customer.groups.id 면 멤버십 전용이다.
 */
export type TimeSaleList = {
  id: string;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  isMembershipOnly: boolean;
};

export type ActiveTimeSale = {
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  priceListIds: string[];
  productIds: string[];
  productHandles: string[];
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

const ACTIVE_SQL = `
  select ${TIME_SALE_LIST_COLUMNS}
  from price_list pl
  where ${TIME_SALE_BASE_WHERE}
    and (pl.starts_at is null or pl.starts_at <= now())
    and (pl.ends_at is null or pl.ends_at >= now())
  order by pl.ends_at asc nulls last
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

/** 어드민이 멤버십용 리스트 제목에 붙이는 접미사 (admin-web `MEMBERSHIP_LIST_TITLE_SUFFIX` 와 같은 값). */
const MEMBERSHIP_LIST_TITLE_SUFFIX = ' (멤버십)';

/** 접미사를 뗀 세일 이름. */
const saleTitle = (list: TimeSaleList): string =>
  list.isMembershipOnly && list.title.endsWith(MEMBERSHIP_LIST_TITLE_SUFFIX)
    ? list.title.slice(0, -MEMBERSHIP_LIST_TITLE_SUFFIX.length)
    : list.title;

/**
 * 일반용·멤버십용 두 리스트를 한 세일로 묶는 키. 짝의 단서는 제목과 시작 시각뿐이다.
 *
 * 제목만 쓰면 같은 이름을 재사용한 다른 기간의 세일(「주말 타임세일」 같은)이 한 그룹으로 섞여,
 * 카운트다운이 남의 마감으로 찍히고 상품 목록이 합쳐진다. 짝은 어드민이 한 번에 만들어 시작
 * 시각이 같으므로 그걸 키에 넣는다 — 종료 시각은 나중에 한쪽만 늘어날 수 있어 키로 못 쓴다.
 */
const saleKey = (list: TimeSaleList): string => `${saleTitle(list)}\u0000${list.startsAt ?? ''}`;

export type TimeSaleDetail = {
  generalId: string | null;
  membershipId: string | null;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  productIds: string[];
  /** variant id → 일반용 세일가. */
  generalPrices: Record<string, number>;
  /** variant id → 멤버십용 세일가. */
  membershipPrices: Record<string, number>;
};

type PriceRow = {
  price_list_id: string;
  amount: string | number;
  variant_id: string;
  product_id: string;
};

const ALL_SQL = `
  select ${TIME_SALE_LIST_COLUMNS}
  from price_list pl
  where ${TIME_SALE_BASE_WHERE}
  order by pl.starts_at desc nulls last
`;

/**
 * 어드민이 보는 타임세일 전부 — 예약·진행·종료를 가리지 않는다.
 *
 * 가격을 **variant id 로** 돌려주는 게 핵심이다. Medusa Admin API 로는 price 에서 variant 로 갈 수
 * 없다 — pricing 모듈은 product 를 모르고, `*prices.price_set.variant` 확장은 mikro-orm 에서
 * 그대로 터진다. 그 사이를 잇는 건 `product_variant_price_set` 링크 테이블뿐이라 여기서 조인한다.
 */
export async function listAllTimeSales(container: MedusaContainer): Promise<TimeSaleDetail[]> {
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const result = await knex.raw(ALL_SQL);
  const lists = toLists((result.rows ?? []) as ListRow[]);

  if (lists.length === 0) return [];

  const placeholders = lists.map(() => '?').join(',');
  const priceResult = await knex.raw(
    `
      select pr.price_list_id, pr.amount, pvps.variant_id, pv.product_id
      from price pr
      join product_variant_price_set pvps on pvps.price_set_id = pr.price_set_id
      join product_variant pv on pv.id = pvps.variant_id and pv.deleted_at is null
      where pr.price_list_id in (${placeholders})
        and pr.deleted_at is null
    `,
    lists.map((list) => list.id)
  );
  const priceRows = (priceResult.rows ?? []) as PriceRow[];

  const groups = new Map<string, TimeSaleList[]>();
  for (const list of lists) {
    const key = saleKey(list);
    const bucket = groups.get(key);
    if (bucket) bucket.push(list);
    else groups.set(key, [list]);
  }

  return [...groups.values()].map((group) => {
    const general = group.find((list) => !list.isMembershipOnly) ?? null;
    const membership = group.find((list) => list.isMembershipOnly) ?? null;
    const face = general ?? group[0];

    const generalPrices: Record<string, number> = {};
    const membershipPrices: Record<string, number> = {};
    const productIds = new Set<string>();

    for (const row of priceRows) {
      const amount = Number(row.amount);
      if (row.price_list_id === general?.id) {
        generalPrices[row.variant_id] = amount;
        productIds.add(row.product_id);
      } else if (row.price_list_id === membership?.id) {
        membershipPrices[row.variant_id] = amount;
        productIds.add(row.product_id);
      }
    }

    return {
      generalId: general?.id ?? null,
      membershipId: membership?.id ?? null,
      title: saleTitle(face),
      startsAt: face.startsAt,
      endsAt: face.endsAt,
      productIds: [...productIds],
      generalPrices,
      membershipPrices,
    };
  });
}

/**
 * 지금 진행 중인 타임세일 전부. 종료가 빠른 순.
 *
 * 세일 하나가 일반용·멤버십용 리스트 둘로 이뤄지므로 제목으로 묶어 되돌린다. 세일이 여럿일 수
 * 있는 이유는 카테고리마다 기간이 다른 세일을 동시에 걸기 때문이다 — 어드민은 **같은 상품이**
 * 겹칠 때만 막고, 기간만 겹치는 건 허용한다.
 *
 * 한 상품이 두 세일에 겹치면 Medusa 가 `rules_count 내림 → amount 오름` 으로 싼 쪽을 고른다.
 * 그 상품은 두 세일 모두의 목록에 뜨지만 카드에 찍히는 가격은 이긴 쪽이라, 종료 시각이 실제보다
 * 길게 보일 수 있다. 겹침을 막는 건 어드민의 몫이다.
 */
export async function listActiveTimeSales(container: MedusaContainer): Promise<ActiveTimeSale[]> {
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const result = await knex.raw(ACTIVE_SQL);
  const lists = toLists((result.rows ?? []) as ListRow[]);

  if (lists.length === 0) return [];

  const products = await listProductsInPriceLists(
    container,
    lists.map((list) => list.id)
  );

  const productsByList = new Map<string, ProductRow[]>();
  for (const product of products) {
    const bucket = productsByList.get(product.price_list_id);
    if (bucket) bucket.push(product);
    else productsByList.set(product.price_list_id, [product]);
  }

  // ACTIVE_SQL 이 종료 빠른 순으로 주고 Map 이 삽입 순서를 지키므로, 그룹 순서가 곧 마감 임박 순이다.
  const groups = new Map<string, TimeSaleList[]>();
  for (const list of lists) {
    const key = saleKey(list);
    const bucket = groups.get(key);
    if (bucket) bucket.push(list);
    else groups.set(key, [list]);
  }

  return [...groups.values()].map((group) => {
    // 일반용 리스트가 세일의 얼굴이다 — 멤버십 전용 리스트는 미구독자에게 안 보이므로 제목이 될 수 없다.
    const face = group.find((list) => !list.isMembershipOnly) ?? group[0];
    const byProductId = new Map<string, ProductRow>();
    for (const list of group) {
      for (const product of productsByList.get(list.id) ?? []) {
        byProductId.set(product.id, product);
      }
    }
    const grouped = [...byProductId.values()];

    return {
      title: saleTitle(face),
      startsAt: face.startsAt,
      // 짝인 두 리스트는 기간이 같지만, 어긋났다면 짧은 쪽을 쓴다 — 카운트다운이 실제보다 길게
      // 보이는 것보다 짧게 보이는 쪽이 안전하다.
      endsAt: group.reduce<string | null>((earliest, list) => {
        if (!list.endsAt) return earliest;
        return !earliest || list.endsAt < earliest ? list.endsAt : earliest;
      }, null),
      priceListIds: group.map((list) => list.id),
      productIds: grouped.map((product) => product.id),
      productHandles: grouped.map((product) => product.handle),
    };
  });
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
