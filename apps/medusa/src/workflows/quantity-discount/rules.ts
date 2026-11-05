/**
 * 수량 할인 가격표 동기화의 판정 규칙. 워크플로가 이 계획대로만 쓴다.
 *
 * 리스트 하나 = `quantity_discount_list` 행(종류·최소수량·기간) + price list 하나(링크).
 * 리스트의 «종류»는 행이 정본이고 제목은 사람이 보는 이름일 뿐이다.
 *   - 일반 : rules = { region_id: [...] }            → 전원
 *   - 회원 : rules = { 'customer.groups.id': [...] } → 멤버십 구독자
 * 둘 다 룰이 1 개다. Medusa 는 `rules_count 내림 → amount 오름` 으로 고르므로, 상시 `Membership Prices`(룰 1 개)·
 * 타임세일과 동률이어야 최저가가 나간다. 일반 쪽 키가 region_id 인 이유: pricing 모듈이 currency_code 를 context 에서
 * 지워 룰로 쓸 수 없고, 전 방문자 컨텍스트에 늘 실리는 키는 region_id 뿐이다. 전 리전을 넣어야 리전이 늘어도 빠지지 않는다.
 */

export type Audience = 'general' | 'membership';
export type TierPriceInput = { variant_id: string; min_quantity: number; amount: number };
export type QuantityDiscountPeriod = { starts_at: string | null; ends_at: string | null };

export type QuantityDiscountSyncInput = {
  period: QuantityDiscountPeriod | null;
  general: TierPriceInput[];
  membership: TierPriceInput[];
};

export type QuantityDiscountListRow = {
  audience: Audience;
  min_quantity: number;
  period_key: string;
  price_list_id: string;
};

/** 모듈 리스트에 걸린 이 상품의 가격 한 행. */
export type CurrentTierPrice = {
  id: string;
  price_list_id: string;
  variant_id: string;
  min_quantity: number;
  amount: number;
};

export type NewListRow = {
  audience: Audience;
  min_quantity: number;
  period_key: string;
  starts_at: string | null;
  ends_at: string | null;
};

export type QuantityDiscountListCreateData = {
  title: string;
  description: string;
  type: 'sale';
  status: 'active';
  starts_at?: string;
  ends_at?: string;
  rules: Record<string, string[]>;
};

export type QuantityDiscountSyncPlan = {
  listsToCreate: Array<{ key: string; row: NewListRow; data: QuantityDiscountListCreateData }>;
  /** 이번에 쓰는 기존 리스트 중 상태·기간·룰이 기대와 다른 것. 리전이 늘었거나 누가 고친 경우를 되돌린다. */
  listUpdates: Array<{
    id: string;
    status: 'active';
    starts_at: string | null;
    ends_at: string | null;
    rules: Record<string, string[]>;
  }>;
  pricesToCreate: Array<{ key: string } & TierPriceInput>;
  priceIdsToDelete: string[];
  /** 동기화 뒤 이 상품의 가격이 들어 있는 리스트(아직 없는 리스트는 key 로 워크플로가 채운다). */
  resultListIds: string[];
  resultKeys: string[];
  /** 이미 리스트가 있는 키 → price list id. 새로 만들 키는 없다. */
  knownListIdByKey: Record<string, string>;
};

const ALWAYS = 'always';
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const kstCompactDate = (iso: string) =>
  new Date(new Date(iso).getTime() + KST_OFFSET_MS).toISOString().slice(0, 10).replace(/-/g, '');

export function periodKey(period: QuantityDiscountPeriod | null): string {
  if (!period || (!period.starts_at && !period.ends_at)) return ALWAYS;
  const start = period.starts_at ? kstCompactDate(period.starts_at) : 'open';
  const end = period.ends_at ? kstCompactDate(period.ends_at) : 'open';
  return `${start}-${end}`;
}

export function listTitle(audience: Audience, minQuantity: number, key: string): string {
  const base = `${audience === 'membership' ? 'Member Tiered Prices' : 'Tiered Prices'} - Min ${minQuantity}`;
  return key === ALWAYS ? base : `${base} - ${key}`;
}

/** price list 의 현재 적용 조건. */
export type PriceListState = {
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  rules: Record<string, string[]>;
};

const sameInstant = (a: string | null, b: string | null) =>
  a === null || b === null ? a === b : new Date(a).getTime() === new Date(b).getTime();

const sameRules = (a: Record<string, string[]>, b: Record<string, string[]>) => {
  const keys = Object.keys(a).sort();
  if (keys.join('|') !== Object.keys(b).sort().join('|')) return false;
  return keys.every((k) => [...a[k]].sort().join('|') === [...(b[k] ?? [])].sort().join('|'));
};

const listKey = (audience: Audience, minQuantity: number, key: string) => `${audience}:${minQuantity}:${key}`;
const priceSignature = (listId: string, p: TierPriceInput) => `${listId}|${p.variant_id}|${p.min_quantity}|${p.amount}`;

export function planQuantityDiscountSync(params: {
  input: QuantityDiscountSyncInput;
  rows: QuantityDiscountListRow[];
  /** 기존 행 리스트의 현재 상태. 모르는 리스트는 기대값으로 갱신한다. */
  listStates: Record<string, PriceListState>;
  /** 이 상품의 가격 중 모듈 리스트에 걸린 것 전부. */
  current: CurrentTierPrice[];
  regionIds: string[];
  membershipGroupId: string;
}): QuantityDiscountSyncPlan {
  const { input, rows, listStates, current, regionIds, membershipGroupId } = params;
  if (input.membership.length > 0 && !membershipGroupId) {
    throw new Error('멤버십 고객그룹 id(MEDUSA_MEMBERSHIP_GROUP_ID)가 없어 회원 구간가를 저장할 수 없습니다.');
  }

  const pKey = periodKey(input.period);
  const listIdByKey = new Map(rows.map((r) => [listKey(r.audience, r.min_quantity, r.period_key), r.price_list_id]));

  const desired: Array<{ key: string; audience: Audience } & TierPriceInput> = [
    ...input.general.map((p) => ({ ...p, audience: 'general' as const, key: listKey('general', p.min_quantity, pKey) })),
    ...input.membership.map((p) => ({
      ...p,
      audience: 'membership' as const,
      key: listKey('membership', p.min_quantity, pKey),
    })),
  ];

  const listsToCreate: QuantityDiscountSyncPlan['listsToCreate'] = [];
  const seenKeys = new Set<string>();
  for (const p of desired) {
    if (seenKeys.has(p.key) || listIdByKey.has(p.key)) {
      seenKeys.add(p.key);
      continue;
    }
    seenKeys.add(p.key);
    const row: NewListRow = {
      audience: p.audience,
      min_quantity: p.min_quantity,
      period_key: pKey,
      starts_at: input.period?.starts_at ?? null,
      ends_at: input.period?.ends_at ?? null,
    };
    listsToCreate.push({
      key: p.key,
      row,
      data: {
        title: listTitle(p.audience, p.min_quantity, pKey),
        description:
          p.audience === 'membership'
            ? `Membership bulk discount for quantity ${p.min_quantity}+`
            : `Bulk discount for quantity ${p.min_quantity}+`,
        type: 'sale',
        status: 'active',
        ...(row.starts_at ? { starts_at: row.starts_at } : {}),
        ...(row.ends_at ? { ends_at: row.ends_at } : {}),
        rules:
          p.audience === 'membership' ? { 'customer.groups.id': [membershipGroupId] } : { region_id: regionIds },
      },
    });
  }

  const listUpdates: QuantityDiscountSyncPlan['listUpdates'] = [];
  for (const key of seenKeys) {
    const listId = listIdByKey.get(key);
    if (!listId) continue;
    const [audience] = key.split(':');
    const rules: Record<string, string[]> =
      audience === 'membership' ? { 'customer.groups.id': [membershipGroupId] } : { region_id: [...regionIds] };
    const expected = {
      id: listId,
      status: 'active' as const,
      starts_at: input.period?.starts_at ?? null,
      ends_at: input.period?.ends_at ?? null,
      rules,
    };
    const state = listStates[listId];
    const conforms =
      state &&
      state.status === 'active' &&
      sameInstant(state.starts_at, expected.starts_at) &&
      sameInstant(state.ends_at, expected.ends_at) &&
      sameRules(state.rules, expected.rules);
    if (!conforms) listUpdates.push(expected);
  }

  const desiredSignatures = new Set<string>();
  const pricesToCreate: QuantityDiscountSyncPlan['pricesToCreate'] = [];
  const currentSignatures = new Set(current.map((c) => priceSignature(c.price_list_id, c)));
  for (const p of desired) {
    const listId = listIdByKey.get(p.key);
    const { audience: _audience, ...price } = p;
    if (listId) {
      const sig = priceSignature(listId, p);
      desiredSignatures.add(sig);
      if (currentSignatures.has(sig)) continue;
    }
    pricesToCreate.push(price);
  }

  const priceIdsToDelete = current.filter((c) => !desiredSignatures.has(priceSignature(c.price_list_id, c))).map((c) => c.id);
  const resultKeys = [...seenKeys];
  const resultListIds = resultKeys.map((k) => listIdByKey.get(k)).filter((id): id is string => Boolean(id));

  const knownListIdByKey = Object.fromEntries(
    resultKeys.flatMap((k) => {
      const id = listIdByKey.get(k);
      return id ? [[k, id]] : [];
    }),
  );

  return {
    listsToCreate,
    listUpdates,
    pricesToCreate,
    priceIdsToDelete,
    resultListIds,
    resultKeys,
    knownListIdByKey,
  };
}
