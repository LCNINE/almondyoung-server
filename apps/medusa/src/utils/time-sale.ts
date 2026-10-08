import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
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
  status: 'active' | 'draft';
};

export type TimeSaleProductPeriod = {
  productId: string;
  startsAt: string | null;
  endsAt: string | null;
};

export type TimeSaleGroupPeriod = {
  generalId: string | null;
  membershipId: string | null;
  productId: string | null;
  startsAt: string | null;
  endsAt: string | null;
};

export type ActiveTimeSale = {
  saleId: string;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  priceListIds: string[];
  productIds: string[];
  productHandles: string[];
  products: TimeSaleProductPeriod[];
};

const TIME_SALE_LIST_COLUMNS = `
  pl.id,
  pl.title,
  pl.status,
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

// 경계를 지났거나(종료) 곧 지날(시작) 리스트.
// 종료된 리스트도 잡아야 하므로 활성 창 조건을 걸지 않는다.
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
  status: 'active' | 'draft';
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
    status: row.status ?? 'active',
  }));

/**
 * price list 에 가격이 걸린 판매중 상품.
 * 세일 종료 뒤에도 가격 행은 남으므로 종료된 리스트에도 쓸 수 있다.
 *
 * 어느 리스트에서 나왔는지(`price_list_id`)를 같이 준다 — 세일이 여럿이면 그걸로 갈라야 한다.
 * 한 상품이 두 리스트에 걸려 있으면 행도 둘이니, 상품 단위로 쓰는 쪽은 중복을 걷어내야 한다.
 */
export async function listProductsInPriceLists(
  container: MedusaContainer,
  priceListIds: string[],
): Promise<ProductRow[]> {
  if (priceListIds.length === 0) return [];

  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  // `= any(?)` 는 드라이버가 배열을 펼쳐 넣어 문법이 깨지는 사례가 있어 placeholder 를 직접 만든다.
  const placeholders = priceListIds.map(() => '?').join(',');
  // 정렬 기준은 판매순 → 리뷰순 → 최신순. 홈 타임세일이 이 순서를 그대로 쓰므로
  // 여기서 한 번만 정한다 —
  // 스토어프론트가 다시 정렬하면 정렬에 필요한 판매량·리뷰수를 상품 응답에 또 실어야 한다.
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
    priceListIds,
  );

  return (result.rows ?? []) as ProductRow[];
}

// 주어진 상품 중 지금 진행 중인 타임세일 가격표에 가격이 걸린 상품 id 집합.
export async function productsInActiveTimeSales(
  container: MedusaContainer,
  productIds: string[],
): Promise<Set<string>> {
  if (productIds.length === 0) return new Set();

  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const placeholders = productIds.map(() => '?').join(',');
  const result = await knex.raw(
    `
      select distinct pv.product_id
      from price pr
      join price_list pl on pl.id = pr.price_list_id
      join product_variant_price_set pvps on pvps.price_set_id = pr.price_set_id
      join product_variant pv on pv.id = pvps.variant_id and pv.deleted_at is null
      where ${TIME_SALE_BASE_WHERE}
        and (pl.starts_at is null or pl.starts_at <= now())
        and (pl.ends_at is null or pl.ends_at >= now())
        and pr.deleted_at is null
        and pv.product_id in (${placeholders})
    `,
    productIds,
  );

  return new Set(((result.rows ?? []) as { product_id: string }[]).map((row) => row.product_id));
}

// 주어진 상품 중 타임세일 가격표에 가격이 걸린 적 있는 상품 id 집합.
// 상태·기간·삭제 여부를 가리지 않는다.
export async function productsInAnyTimeSales(container: MedusaContainer, productIds: string[]): Promise<Set<string>> {
  if (productIds.length === 0) return new Set();

  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const placeholders = productIds.map(() => '?').join(',');
  const result = await knex.raw(
    `
      select distinct pv.product_id
      from price pr
      join price_list pl on pl.id = pr.price_list_id
      join product_variant_price_set pvps on pvps.price_set_id = pr.price_set_id
      join product_variant pv on pv.id = pvps.variant_id and pv.deleted_at is null
      where pl.type = 'sale'
        and (pl.starts_at is not null or pl.ends_at is not null)
        and pv.product_id in (${placeholders})
    `,
    productIds,
  );

  return new Set(((result.rows ?? []) as { product_id: string }[]).map((row) => row.product_id));
}

/** 어드민이 멤버십용 리스트 제목에 붙이는 접미사 (admin-web `MEMBERSHIP_LIST_TITLE_SUFFIX` 와 같은 값). */
export const MEMBERSHIP_LIST_TITLE_SUFFIX = ' (멤버십)';

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

type StoredSale = {
  repeatHours?: number;
  repeatUntil?: string | null;
  groups?: { generalId: string | null; membershipId: string | null; productId: string | null }[];
};

// 설정(Store.metadata)에 저장된 세일별 반복·그룹 정보.
// 가격표만으로는 알 수 없는 묶음 정보의 정본이다.
export async function loadStoredSales(container: MedusaContainer): Promise<Record<string, StoredSale>> {
  const [store] = await container.resolve(Modules.STORE).listStores();
  const settings = store?.metadata?.timeSaleSettings as { sales?: Record<string, StoredSale> } | undefined;

  return settings?.sales ?? {};
}

// 서비스 OFF 로 잠시 초안이 된 가격표 id(켜면 다시 active 가 된다).
async function loadSuspendedPriceListIds(container: MedusaContainer): Promise<Set<string>> {
  const [store] = await container.resolve(Modules.STORE).listStores();
  const settings = store?.metadata?.timeSaleSettings as { environment?: { suspendedPriceListIds?: string[] } };

  return new Set(settings?.environment?.suspendedPriceListIds ?? []);
}

type ListGroup = {
  productId: string | null;
  lists: TimeSaleList[];
};

type SaleBucket = {
  saleId: string;
  lists: TimeSaleList[];
  groups: ListGroup[];
};

/**
 * 세일 하나 = 가격표 묶음 여럿. 설정에 묶음(`groups`)이 적힌 리스트는 그 saleId 로 모으고,
 * 적히지 않은 옛 리스트만 제목 + 시작 시각으로 짝짓는다. 옛 세일의 saleId 는 설정 키와 같은
 * 일반용(없으면 멤버십용) 리스트 id 다.
 */
function bucketLists(lists: TimeSaleList[], stored: Record<string, StoredSale>): SaleBucket[] {
  const owners = new Map<string, { saleId: string; productId: string | null }>();
  for (const [saleId, sale] of Object.entries(stored)) {
    for (const group of sale.groups ?? []) {
      for (const id of [group.generalId, group.membershipId]) {
        if (id) owners.set(id, { saleId, productId: group.productId });
      }
    }
  }

  type OpenBucket = { saleId: string | null; lists: TimeSaleList[]; groups: Map<string, ListGroup> };

  const buckets = new Map<string, OpenBucket>();
  for (const list of lists) {
    const owner = owners.get(list.id);
    const key = owner ? `sale\u0000${owner.saleId}` : `legacy\u0000${saleKey(list)}`;
    const bucket: OpenBucket = buckets.get(key) ?? { saleId: owner?.saleId ?? null, lists: [], groups: new Map() };
    const productId = owner?.productId ?? null;
    const groupKey = productId ?? '';
    const group: ListGroup = bucket.groups.get(groupKey) ?? { productId, lists: [] };

    group.lists.push(list);
    bucket.groups.set(groupKey, group);
    bucket.lists.push(list);
    buckets.set(key, bucket);
  }

  return [...buckets.values()].map((bucket) => {
    const face = bucket.lists.find((list) => !list.isMembershipOnly) ?? bucket.lists[0];

    return { saleId: bucket.saleId ?? face.id, lists: bucket.lists, groups: [...bucket.groups.values()] };
  });
}

const groupFace = (lists: TimeSaleList[]) => lists.find((list) => !list.isMembershipOnly) ?? lists[0];

const earliestEnd = (lists: TimeSaleList[]) =>
  lists.reduce<string | null>((earliest, list) => {
    if (!list.endsAt) return earliest;
    return !earliest || list.endsAt < earliest ? list.endsAt : earliest;
  }, null);

const minIso = (values: (string | null)[]) =>
  values.reduce<string | null>((min, value) => (value && (!min || value < min) ? value : min), null);

const maxIso = (values: (string | null)[]) =>
  values.reduce<string | null>((max, value) => (value && (!max || value > max) ? value : max), null);

export type TimeSaleDetail = {
  saleId: string;
  status: 'active' | 'draft';
  generalId: string | null;
  membershipId: string | null;
  priceListIds: string[];
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  productIds: string[];
  products: TimeSaleProductPeriod[];
  groups: TimeSaleGroupPeriod[];
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
  where ${TIME_SALE_BASE_WHERE.replace("and pl.status = 'active'", '')}
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
    lists.map((list) => list.id),
  );
  const priceRows = (priceResult.rows ?? []) as PriceRow[];

  const stored = await loadStoredSales(container);

  return bucketLists(lists, stored).map((bucket) => {
    const face = groupFace(bucket.lists);
    const generalPrices: Record<string, number> = {};
    const membershipPrices: Record<string, number> = {};
    const productIds = new Set<string>();
    const products: TimeSaleProductPeriod[] = [];
    const groups: TimeSaleGroupPeriod[] = [];

    for (const group of bucket.groups) {
      const general = group.lists.find((list) => !list.isMembershipOnly) ?? null;
      const membership = group.lists.find((list) => list.isMembershipOnly) ?? null;
      const period = groupFace(group.lists);
      const groupProducts = new Set<string>();

      for (const row of priceRows) {
        const amount = Number(row.amount);
        if (row.price_list_id === general?.id) generalPrices[row.variant_id] = amount;
        else if (row.price_list_id === membership?.id) membershipPrices[row.variant_id] = amount;
        else continue;

        if (group.productId === null || group.productId === row.product_id) groupProducts.add(row.product_id);
      }

      groups.push({
        generalId: general?.id ?? null,
        membershipId: membership?.id ?? null,
        productId: group.productId,
        startsAt: period.startsAt,
        endsAt: period.endsAt,
      });

      for (const productId of groupProducts) {
        if (productIds.has(productId)) continue;

        productIds.add(productId);
        products.push({ productId, startsAt: period.startsAt, endsAt: period.endsAt });
      }
    }

    return {
      saleId: bucket.saleId,
      status: face.status,
      generalId: groups[0]?.generalId ?? null,
      membershipId: groups[0]?.membershipId ?? null,
      priceListIds: bucket.lists.map((list) => list.id),
      title: saleTitle(face),
      startsAt: minIso(groups.map((group) => group.startsAt)),
      endsAt: maxIso(groups.map((group) => group.endsAt)),
      productIds: [...productIds],
      products,
      groups,
      generalPrices,
      membershipPrices,
    };
  });
}

export type TimeSaleWindow = {
  startsAt: string;
  endsAt: string;
  repeatHours: number;
  repeatUntil: string | null;
};

// 반복 세일 겹침 계산은 기간을 (시작, 길이, 반복 주기, 횟수) 등차수열로 보고 푼다.
const HOUR = 3600000;

// 유한 반복 두 개를 회차 단위로 훑을 때의 상한. 넘으면 계산하지 않고
// 겹친다고 본다(fail-closed: 놓쳐서 중복 세일이 걸리는 것보다 막는 쪽).
const MAX_ITERATED_CYCLES = 1000000;

type Series = { start: number; duration: number; period: number; count: number };

// 기간+반복 설정을 수열로 바꾼다. 주기가 (길이 + 10분)보다 짧으면 반복이
// 성립하지 않아 1회짜리로 보고, 날짜가 깨졌으면 null(겹침으로 취급).
const toSeries = (window: TimeSaleWindow): Series | null => {
  const start = Date.parse(window.startsAt),
    end = Date.parse(window.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;

  const duration = end - start;
  const period = Math.round(window.repeatHours * HOUR);
  if (!Number.isFinite(period) || period <= 0 || period < duration + 600000)
    return { start, duration, period: 0, count: 1 };
  if (!window.repeatUntil) return { start, duration, period, count: Infinity };

  const until = Date.parse(window.repeatUntil);
  if (!Number.isFinite(until)) return null;

  return { start, duration, period, count: 1 + Math.max(0, Math.floor((until - end) / period)) };
};

// 수열의 어느 회차가 [from, to) 구간과 겹치는지.
const hitsInterval = (series: Series, from: number, to: number): boolean => {
  if (series.period === 0) return series.start < to && series.start + series.duration > from;

  const k = Math.max(0, Math.floor((from - series.start - series.duration) / series.period) + 1);

  return k < series.count && series.start + k * series.period < to;
};

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

// 끝없이 반복하는 두 수열이 언젠가 겹치는지: 두 주기의
// 최대공약수 간격으로 시작 시각 차이를 맞춰 본다.
const unboundedOverlap = (a: Series, b: Series): boolean => {
  const step = gcd(a.period, b.period);
  const delta = b.start - a.start;
  const t = Math.floor((-b.duration - delta) / step) + 1;

  return delta + t * step < a.duration;
};

// 반복을 펼친 두 세일 기간이 한 번이라도 겹치는지. 1회짜리가 있으면 구간
// 검사, 둘 다 무한이면 수학적으로, 유한이면 적은 쪽 회차를 순회한다.
export function overlapsWithRepeats(a: TimeSaleWindow, b: TimeSaleWindow): boolean {
  const left = toSeries(a),
    right = toSeries(b);
  if (!left || !right) return true;

  if (left.count === 1) return hitsInterval(right, left.start, left.start + left.duration);
  if (right.count === 1) return hitsInterval(left, right.start, right.start + right.duration);
  if (left.count === Infinity && right.count === Infinity) return unboundedOverlap(left, right);

  const [few, many] = left.count <= right.count ? [left, right] : [right, left];
  if (few.count > MAX_ITERATED_CYCLES) return true;

  for (let k = 0; k < few.count; k++) {
    const from = few.start + k * few.period;
    if (hitsInterval(many, from, from + few.duration)) return true;
  }

  return false;
}

// 겹침 하나: 충돌한 세일의 가격표·이름과 겹친 상품.
export type TimeSaleOverlap = { priceListId: string; title: string; productId: string };

// 같은 상품이 겹치는 기간(반복 포함)에 이미 활성 세일에 걸려
// 있는지 찾는다. excludePriceListIds 는 지금 저장 중인 세일 자신.
export async function findOverlappingTimeSales(
  container: MedusaContainer,
  input: {
    productIds: string[];
    startsAt: string;
    endsAt: string;
    repeatHours: number;
    repeatUntil: string | null;
    excludePriceListIds: string[];
  },
): Promise<TimeSaleOverlap[]> {
  if (input.productIds.length === 0) return [];

  const [sales, repeats, suspended] = await Promise.all([
    listAllTimeSales(container),
    loadStoredSales(container),
    loadSuspendedPriceListIds(container),
  ]);
  const wanted = new Set(input.productIds);
  const excluded = new Set(input.excludePriceListIds);
  const overlaps: TimeSaleOverlap[] = [];

  for (const sale of sales) {
    // 서비스 OFF 로 멈춘 세일도 켜면 다시 active 라 겹침 대상이다.
    if (sale.status !== 'active' && !sale.priceListIds.some((id) => suspended.has(id))) continue;
    if (sale.priceListIds.some((id) => excluded.has(id))) continue;

    // 기간 겹침 자체는 통과다 — 카테고리마다 기간이 다른 세일을 동시에 거는 게 목적이다.
    // 같은 품목이 두 세일에 걸리면 Medusa 가 한쪽 가격만 적용하므로 그때만 막는다.
    const repeat = repeats[sale.saleId] ?? {};
    for (const product of sale.products) {
      if (!wanted.has(product.productId) || !product.startsAt || !product.endsAt) continue;

      const window = {
        startsAt: product.startsAt,
        endsAt: product.endsAt,
        repeatHours: repeat.repeatHours ?? 0,
        repeatUntil: repeat.repeatUntil ?? null,
      };
      if (!overlapsWithRepeats(window, input)) continue;

      overlaps.push({ priceListId: sale.priceListIds[0], title: sale.title, productId: product.productId });
    }
  }

  return overlaps;
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
    lists.map((list) => list.id),
  );

  // ACTIVE_SQL 이 종료 빠른 순으로 주고 Map 이 삽입 순서를 지키므로, 그룹 순서가 곧 마감 임박 순이다.
  const stored = await loadStoredSales(container);

  return bucketLists(lists, stored).map((bucket) => {
    // 일반용 리스트가 세일의 얼굴이다 —
    // 멤버십 전용 리스트는 미구독자에게 안 보이므로 제목이 될 수 없다.
    const face = groupFace(bucket.lists);
    const periodByList = new Map<
      string,
      { productId: string | null; startsAt: string | null; endsAt: string | null }
    >();
    for (const group of bucket.groups) {
      // 짝인 두 리스트는 기간이 같지만, 어긋났다면 짧은 쪽을 쓴다 — 카운트다운이 실제보다 길게
      // 보이는 것보다 짧게 보이는 쪽이 안전하다.
      const period = {
        productId: group.productId,
        startsAt: groupFace(group.lists).startsAt,
        endsAt: earliestEnd(group.lists),
      };
      for (const list of group.lists) periodByList.set(list.id, period);
    }

    const byProductId = new Map<string, { product: ProductRow; startsAt: string | null; endsAt: string | null }>();
    for (const product of products) {
      const period = periodByList.get(product.price_list_id);
      if (!period || byProductId.has(product.id)) continue;
      if (period.productId !== null && period.productId !== product.id) continue;

      byProductId.set(product.id, { product, startsAt: period.startsAt, endsAt: period.endsAt });
    }
    const grouped = [...byProductId.values()];
    const periods = [...periodByList.values()];

    return {
      saleId: bucket.saleId,
      title: saleTitle(face),
      startsAt: minIso(periods.map((period) => period.startsAt)),
      endsAt: maxIso(periods.map((period) => period.endsAt)),
      priceListIds: bucket.lists.map((list) => list.id),
      productIds: grouped.map(({ product }) => product.id),
      productHandles: grouped.map(({ product }) => product.handle),
      products: grouped.map(({ product, startsAt, endsAt }) => ({ productId: product.id, startsAt, endsAt })),
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
  prewarmSeconds: number,
): Promise<TimeSaleList[]> {
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const result = await knex.raw(CROSSED_BOUNDARY_SQL, [prewarmSeconds, windowSeconds, prewarmSeconds, windowSeconds]);
  return toLists((result.rows ?? []) as ListRow[]);
}
