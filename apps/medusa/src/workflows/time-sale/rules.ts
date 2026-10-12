/**
 * 타임세일 저장의 판정 규칙. 워크플로·라우트·복구 스크립트가 같은 규칙을 쓰도록 순수 함수로 둔다.
 *
 * 세일 하나 = `time_sale` 행 + price list 두 개까지.
 *   - 일반용   : rules = { region_id: [...] }            → 전원
 *   - 멤버십용 : rules = { 'customer.groups.id': [...] } → 멤버십 구독자
 * 둘 다 룰이 1 개인 이유: Medusa 는 `rules_count 내림 → amount 오름` 으로 가격을 고른다. 상시 운영되는
 * `Membership Prices` 가 룰 1 개라, 세일 리스트가 룰 0 개면 아무리 싸도 진다.
 */

export type TimeSaleStatus = 'draft' | 'active';
export type TimeSalePriceInput = { variant_id: string; amount: number };

export type TimeSaleWriteInput = {
  title: string;
  starts_at: string;
  ends_at: string;
  status: TimeSaleStatus;
  general_prices: TimeSalePriceInput[];
  membership_prices: TimeSalePriceInput[];
};

export const GENERAL_LIST_DESCRIPTION = '타임세일 (전체)';
export const MEMBERSHIP_LIST_DESCRIPTION = '타임세일 (멤버십 구독자)';
const CURRENCY = 'krw' as const;

const duplicates = (prices: TimeSalePriceInput[]): string[] => {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const { variant_id } of prices) {
    if (seen.has(variant_id)) dup.add(variant_id);
    seen.add(variant_id);
  }
  return [...dup];
};

export function validateTimeSaleInput(input: TimeSaleWriteInput): string[] {
  const errors: string[] = [];

  if (!input.title.trim()) errors.push('세일 이름이 비어 있습니다.');
  if (!(Date.parse(input.ends_at) > Date.parse(input.starts_at))) {
    errors.push('종료 시각은 시작 시각보다 뒤여야 합니다.');
  }
  if (input.general_prices.length === 0) errors.push('세일가를 넣은 품목이 하나도 없습니다.');

  for (const [label, prices] of [
    ['일반', input.general_prices],
    ['멤버십', input.membership_prices],
  ] as const) {
    for (const price of prices) {
      // NaN·Infinity 는 비교가 전부 false 라 걸러내지 않으면 `amount: null` 로 직렬화돼 Medusa 까지 간다.
      if (!Number.isFinite(price.amount) || price.amount <= 0) {
        errors.push(`${label} 세일가는 0보다 큰 숫자여야 합니다 (${price.variant_id}).`);
      }
    }
    const dup = duplicates(prices);
    if (dup.length > 0) errors.push(`${label} 세일가에 같은 품목이 두 번 있습니다: ${dup.join(', ')}`);
  }

  // 멤버십 세일가만 있고 일반 세일가가 없는 품목은 «구독자만 싸게 사는» 상태라 막는다.
  const general = new Set(input.general_prices.map((p) => p.variant_id));
  const orphan = input.membership_prices.filter((p) => !general.has(p.variant_id)).map((p) => p.variant_id);
  if (orphan.length > 0) errors.push(`일반 세일가 없이 멤버십 세일가만 있는 품목: ${orphan.join(', ')}`);

  return errors;
}

export type SaleFootprint = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  status: TimeSaleStatus;
  variantIds: string[];
};

/**
 * 기간이 겹치고 같은 품목을 쓰는 active 세일. 같은 품목이 두 세일에 걸리면 Medusa 가 한쪽 가격만
 * 적용해, 손님은 A 세일 목록에서 B 의 가격과 A 의 카운트다운을 보게 된다.
 *
 * draft 는 가격 계산에서 빠지므로 어느 쪽이든 draft 면 겹침이 아니다 — 대신 공개(draft → active)할 때
 * 이 검사를 다시 탄다.
 */
export function findConflictingSales(
  candidate: Omit<SaleFootprint, 'id' | 'title'> & { id?: string },
  others: SaleFootprint[],
): Array<{ id: string; title: string; variantIds: string[] }> {
  if (candidate.status !== 'active') return [];
  const start = Date.parse(candidate.starts_at);
  const end = Date.parse(candidate.ends_at);
  const mine = new Set(candidate.variantIds);

  return others
    .filter((other) => other.id !== candidate.id && other.status === 'active')
    .filter((other) => start < Date.parse(other.ends_at) && end > Date.parse(other.starts_at))
    .map((other) => ({
      id: other.id,
      title: other.title,
      variantIds: other.variantIds.filter((id) => mine.has(id)),
    }))
    .filter((conflict) => conflict.variantIds.length > 0);
}

export type PriceListCreateData = {
  title: string;
  description: string;
  type: 'sale';
  status: TimeSaleStatus;
  starts_at: string;
  ends_at: string;
  rules: Record<string, string[]>;
  prices: Array<TimeSalePriceInput & { currency_code: typeof CURRENCY }>;
};

const withCurrency = (prices: TimeSalePriceInput[]) =>
  prices.map((p) => ({ variant_id: p.variant_id, amount: p.amount, currency_code: CURRENCY }));

export function buildPriceListData(params: {
  title: string;
  starts_at: string;
  ends_at: string;
  status: TimeSaleStatus;
  audience: 'general' | 'membership';
  prices: TimeSalePriceInput[];
  regionIds: string[];
  membershipGroupId: string;
}): PriceListCreateData {
  const membership = params.audience === 'membership';
  return {
    title: params.title,
    description: membership ? MEMBERSHIP_LIST_DESCRIPTION : GENERAL_LIST_DESCRIPTION,
    type: 'sale',
    status: params.status,
    starts_at: params.starts_at,
    ends_at: params.ends_at,
    rules: membership ? { 'customer.groups.id': [params.membershipGroupId] } : { region_id: params.regionIds },
    prices: withCurrency(params.prices),
  };
}

/** 리스트에 살아있는 가격 한 행. variant 링크가 끊긴 가격은 `variant_id` 가 null 이다. */
export type LinkedPrice = { id: string; variant_id: string | null; amount: number };
export type LinkedList = { id: string; isMembership: boolean; prices: LinkedPrice[] };

export type TimeSaleUpdatePlan = {
  listUpdates: Array<{ id: string; title: string; starts_at: string; ends_at: string; status: TimeSaleStatus }>;
  listsToCreate: PriceListCreateData[];
  listIdsToDelete: string[];
  pricesToCreate: Array<{ id: string; prices: Array<TimeSalePriceInput & { currency_code: typeof CURRENCY }> }>;
  priceIdsToDelete: string[];
};

/**
 * 리스트의 현재 가격이 입력과 «품목→금액» 으로 정확히 같은가. 같은 품목이 두 행이거나(누적 사고의 흔적),
 * variant 링크가 끊긴 행이 있으면 다르다고 본다 — 교체가 그 행들을 치운다.
 */
function samePrices(existing: LinkedPrice[], incoming: TimeSalePriceInput[]): boolean {
  if (existing.length !== incoming.length) return false;
  const wanted = new Map(incoming.map((p) => [p.variant_id, p.amount]));
  const seen = new Set<string>();
  for (const price of existing) {
    if (price.variant_id === null || seen.has(price.variant_id)) return false;
    if (wanted.get(price.variant_id) !== price.amount) return false;
    seen.add(price.variant_id);
  }
  return true;
}

/**
 * 수정 한 번이 바꿀 것을 미리 계산한다. 가격이 바뀐 리스트는 **전부 지우고 새로 넣는다** — 개별 diff 는
 * 빠진 상품의 행을 놓쳐, 세일에서 뺐다고 생각한 상품이 계속 세일가로 팔린다.
 *
 * 품목→금액이 그대로인 리스트는 가격을 건드리지 않는다(메타만 갱신). 공개·비공개 전환은 가격을 통째로
 * 다시 보내는데, 복구 세일 ①(741+741)을 전부 지우고 다시 만들면 어드민 프록시의 30초를 넘긴다.
 *
 * 지울 가격 id 는 서버가 DB 에서 직접 얻은 것이어야 한다(호출자가 `loadLinkedLists` 의 raw SQL 로
 * 채운다). 2026-10-09 사고는 이 목록을 브라우저가 Admin API 응답에서 얻다가 빈 채로 받아, 지우지 못하고
 * 덧붙인 것이다.
 */
export function planTimeSaleUpdate(params: {
  input: TimeSaleWriteInput;
  lists: LinkedList[];
  regionIds: string[];
  membershipGroupId: string;
}): TimeSaleUpdatePlan {
  const { input, lists, regionIds, membershipGroupId } = params;
  const general = lists.find((list) => !list.isMembership);
  if (!general) throw new Error('일반용 price list 가 연결되지 않은 타임세일입니다.');
  const membership = lists.find((list) => list.isMembership) ?? null;
  const wantsMembership = input.membership_prices.length > 0;

  const meta = { title: input.title, starts_at: input.starts_at, ends_at: input.ends_at, status: input.status };
  const plan: TimeSaleUpdatePlan = {
    listUpdates: [],
    listsToCreate: [],
    listIdsToDelete: [],
    pricesToCreate: [],
    priceIdsToDelete: [],
  };
  const keepOrReplace = (list: LinkedList, prices: TimeSalePriceInput[]) => {
    plan.listUpdates.push({ id: list.id, ...meta });
    if (samePrices(list.prices, prices)) return;
    plan.pricesToCreate.push({ id: list.id, prices: withCurrency(prices) });
    plan.priceIdsToDelete.push(...list.prices.map((p) => p.id));
  };

  keepOrReplace(general, input.general_prices);

  if (membership && wantsMembership) {
    keepOrReplace(membership, input.membership_prices);
  } else if (membership && !wantsMembership) {
    // 리스트를 지우면 가격도 함께 사라진다. 옛 리스트가 남으면 구독자만 옛 가격에 산다.
    plan.listIdsToDelete.push(membership.id);
  } else if (!membership && wantsMembership) {
    plan.listsToCreate.push(
      buildPriceListData({
        ...meta,
        audience: 'membership',
        prices: input.membership_prices,
        regionIds,
        membershipGroupId,
      }),
    );
  }

  return plan;
}
