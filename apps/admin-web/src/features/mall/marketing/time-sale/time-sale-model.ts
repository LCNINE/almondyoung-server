/**
 * 타임세일 도메인 규칙. 화면과 분리해 둔다 — 여기 있는 판정이 가격에 직결된다.
 *
 * 타임세일 하나는 Medusa price list **두 개**로 저장된다.
 *   - 일반용   : rules = { region_id: [...] }            → 전원
 *   - 멤버십용 : rules = { 'customer.groups.id': [...] } → 멤버십 구독자
 *
 * 둘 다 룰이 1 개인 이유는 Medusa 가 `rules_count 내림 → amount 오름` 으로 가격을 고르기 때문이다.
 * 상시 운영되는 `Membership Prices` 가 룰 1 개라, 세일 리스트가 룰 0 개면 아무리 싸도 진다.
 */

export type TimeSaleStatus = 'scheduled' | 'active' | 'ended';

export type TimeSalePeriod = {
  startsAt: string;
  endsAt: string;
};

/** 세일에 올릴 variant 한 줄. base/membershipBase 는 현재 판매가고, sale 필드가 입력값이다. */
export type TimeSaleRow = {
  variantId: string;
  productId: string;
  productTitle: string;
  variantTitle: string;
  basePrice: number;
  /** 멤버십가가 없는 상품(라이브 기준 54%)은 null. 이때 멤버십 세일가도 만들지 않는다. */
  membershipBasePrice: number | null;
  generalSalePrice: number | null;
  membershipSalePrice: number | null;
};

export type RowError = { variantId: string; message: string };

export type SaleRowsSummary = {
  total: number;
  filled: number;
  /** 정가 대비 할인율. 품목마다 다르면 최소~최대. 입력된 게 없으면 null. */
  minPercent: number | null;
  maxPercent: number | null;
  minPrice: number | null;
  maxPrice: number | null;
};

/**
 * 접힌 상품 줄에 보여줄 세일가 요약.
 *
 * "입력 111개" 만으로는 얼마로 채워졌는지 알 수 없어 운영자가 111 개를 펼쳐 확인하게 된다.
 * 할인율과 가격 범위를 접힌 채로 보여주면 일괄 적용이 먹었는지 한눈에 판정된다.
 */
/**
 * 이미 등록된 세일을 편집 행으로 되돌린다.
 *
 * 정가·멤버십가는 상품 응답에서 다시 읽고(그 사이 바뀌었을 수 있다), 세일가만 price list 에서
 * 덮는다. 반대로 하면 편집 화면이 등록 당시의 낡은 정가를 기준으로 검증하게 된다.
 */
export function applySavedSalePrices(
  rows: TimeSaleRow[],
  saved: { general: Map<string, number>; membership: Map<string, number> }
): TimeSaleRow[] {
  return rows.map((row) => ({
    ...row,
    generalSalePrice: saved.general.get(row.variantId) ?? null,
    membershipSalePrice:
      row.membershipBasePrice === null ? null : (saved.membership.get(row.variantId) ?? null),
  }));
}

export function summarizeSaleRows(rows: TimeSaleRow[]): SaleRowsSummary {
  const filled = rows.filter(
    (row) => row.generalSalePrice !== null && row.basePrice > 0
  );

  if (filled.length === 0) {
    return {
      total: rows.length,
      filled: 0,
      minPercent: null,
      maxPercent: null,
      minPrice: null,
      maxPrice: null,
    };
  }

  const percents = filled.map((row) =>
    Math.round(((row.basePrice - (row.generalSalePrice as number)) / row.basePrice) * 100)
  );
  const prices = filled.map((row) => row.generalSalePrice as number);

  return {
    total: rows.length,
    filled: filled.length,
    minPercent: Math.min(...percents),
    maxPercent: Math.max(...percents),
    minPrice: Math.min(...prices),
    maxPrice: Math.max(...prices),
  };
}

export function resolveTimeSaleStatus(period: TimeSalePeriod, now: Date): TimeSaleStatus {
  const start = Date.parse(period.startsAt);
  const end = Date.parse(period.endsAt);
  const at = now.getTime();

  if (at < start) return 'scheduled';
  if (at >= end) return 'ended';
  return 'active';
}

export const TIME_SALE_STATUS_LABEL: Record<TimeSaleStatus, string> = {
  scheduled: '예약',
  active: '진행중',
  ended: '종료',
};

/**
 * 기간이 겹치는 세일.
 *
 * 겹친다는 사실만으로는 막지 않는다 — 카테고리마다 기간이 다른 세일을 동시에 거는 게 요구사항이라
 * 기간 겹침은 정상이다. 여기서 나온 세일들과 **상품이** 겹치는지를 `findVariantConflicts` 로 한 번
 * 더 본다.
 */
export function findOverlapping<T extends TimeSalePeriod & { id?: string }>(
  candidate: TimeSalePeriod & { id?: string },
  existing: T[]
): T[] {
  const start = Date.parse(candidate.startsAt);
  const end = Date.parse(candidate.endsAt);

  return existing.filter((other) => {
    if (candidate.id && other.id === candidate.id) return false;
    return start < Date.parse(other.endsAt) && end > Date.parse(other.startsAt);
  });
}

/**
 * 기간이 겹치는 세일 중 **같은 품목을 쓰는** 것들.
 *
 * 상품이 겹치면 Medusa 가 `rules_count 내림 → amount 오름` 으로 한쪽 가격만 적용한다. 손님은 A
 * 세일 목록에서 B 세일의 가격을 보면서 A 의 카운트다운을 읽게 되고, A 가 끝나도 가격이 안 변한다.
 * 기간만 겹치는 건 통과시키고 이 경우만 막는다.
 */
export function findVariantConflicts<T extends { variantIds: string[] }>(
  variantIds: string[],
  overlapping: T[]
): Array<T & { conflictingVariantIds: string[] }> {
  const candidate = new Set(variantIds);

  return overlapping
    .map((sale) => ({
      ...sale,
      conflictingVariantIds: sale.variantIds.filter((id) => candidate.has(id)),
    }))
    .filter((sale) => sale.conflictingVariantIds.length > 0);
}

/**
 * "정가의 N% 할인" 일괄 채우기.
 *
 * 같은 N 을 각자의 기준에 적용한다 — 일반은 정가에서, 멤버십은 멤버십가에서. 그래야 "전 상품 20%
 * 추가 할인" 한 문장으로 설명되고, 멤버십 세일가가 멤버십가보다 반드시 싸져 검증에 걸리지 않는다.
 * 정가 기준 하나로 양쪽을 채우면 멤버십 할인율이 N 보다 큰 상품이 전부 저장 거부된다
 * (라이브 기준 할인 있는 variant 의 중앙값이 20%).
 */
export function applyPercentDiscount(rows: TimeSaleRow[], percent: number): TimeSaleRow[] {
  const rate = 1 - percent / 100;

  return rows.map((row) => ({
    ...row,
    generalSalePrice: Math.round(row.basePrice * rate),
    membershipSalePrice:
      row.membershipBasePrice === null ? null : Math.round(row.membershipBasePrice * rate),
  }));
}

/**
 * 저장 가능한지.
 *
 * 세일가가 현재가보다 비싸면 뱃지만 붙고 가격은 그대로다 — "세일이라며 왜 그대로냐" CS 가 된다.
 * 화면에서 눈으로 비교되긴 하지만 상품이 스무 개면 놓친다.
 */
export function validateRows(rows: TimeSaleRow[]): RowError[] {
  const errors: RowError[] = [];

  for (const row of rows) {
    if (row.generalSalePrice === null) {
      errors.push({ variantId: row.variantId, message: '세일가를 입력하세요.' });
      continue;
    }
    if (row.generalSalePrice <= 0) {
      errors.push({ variantId: row.variantId, message: '세일가는 0원보다 커야 합니다.' });
      continue;
    }
    if (row.generalSalePrice >= row.basePrice) {
      errors.push({
        variantId: row.variantId,
        message: `세일가는 정가(${row.basePrice.toLocaleString()}원)보다 낮아야 합니다.`,
      });
    }
    if (
      row.membershipBasePrice !== null &&
      row.membershipSalePrice !== null &&
      row.membershipSalePrice >= row.membershipBasePrice
    ) {
      errors.push({
        variantId: row.variantId,
        message: `멤버십 세일가는 멤버십가(${row.membershipBasePrice.toLocaleString()}원)보다 낮아야 합니다.`,
      });
    }
  }

  return errors;
}

export type PriceListPricePayload = {
  amount: number;
  currency_code: string;
  variant_id: string;
};

export type PriceListPayload = {
  title: string;
  description: string;
  type: 'sale';
  status: 'active';
  starts_at: string;
  ends_at: string;
  rules: Record<string, string[]>;
  prices: PriceListPricePayload[];
};

const CURRENCY = 'krw';

/** 멤버십용 리스트는 제목으로도 구분되게 접미사를 붙인다 — Medusa 기본 어드민 목록에서 사람이 읽는다. */
export const MEMBERSHIP_LIST_TITLE_SUFFIX = ' (멤버십)';

/**
 * 타임세일 하나 → price list 페이로드 (일반용, 멤버십용).
 *
 * 멤버십 세일가가 하나도 없으면 멤버십용 리스트를 만들지 않는다. 그래도 멤버십 구독자는 일반용
 * 리스트(전원 대상)를 받으므로 세일에서 빠지지 않는다.
 */
export function buildPriceListPayloads(params: {
  title: string;
  period: TimeSalePeriod;
  rows: TimeSaleRow[];
  regionIds: string[];
  membershipGroupId: string;
}): { general: PriceListPayload; membership: PriceListPayload | null } {
  const { title, period, rows, regionIds, membershipGroupId } = params;

  const generalPrices = rows
    .filter((row) => row.generalSalePrice !== null)
    .map((row) => ({
      amount: row.generalSalePrice as number,
      currency_code: CURRENCY,
      variant_id: row.variantId,
    }));

  const membershipPrices = rows
    .filter((row) => row.membershipBasePrice !== null && row.membershipSalePrice !== null)
    .map((row) => ({
      amount: row.membershipSalePrice as number,
      currency_code: CURRENCY,
      variant_id: row.variantId,
    }));

  const base = {
    type: 'sale' as const,
    status: 'active' as const,
    starts_at: period.startsAt,
    ends_at: period.endsAt,
  };

  return {
    general: {
      ...base,
      title,
      description: '타임세일 (전체)',
      rules: { region_id: regionIds },
      prices: generalPrices,
    },
    membership:
      membershipPrices.length === 0
        ? null
        : {
            ...base,
            title: `${title}${MEMBERSHIP_LIST_TITLE_SUFFIX}`,
            description: '타임세일 (멤버십 구독자)',
            rules: { 'customer.groups.id': [membershipGroupId] },
            prices: membershipPrices,
          },
  };
}


type RawVariant = {
  id: string;
  title: string;
  metadata?: Record<string, unknown> | null;
  prices?: Array<{ amount: number; currency_code: string; price_list_id?: string | null }>;
};

type RawProduct = { id: string; title: string; variants: RawVariant[] };

const toAmount = (raw: unknown): number | null => {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null;
  if (typeof raw === 'string') {
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
};

/**
 * 상품 응답 → 편집 행.
 *
 * 멤버십가는 `variant.metadata.membershipPrice` 에서 읽는다. Medusa Admin 의 상품 응답은 price list
 * 가격을 싣지 않고 기본가만 준다 — price list 쪽을 보려면 33,000행짜리 멤버십 리스트를 통째로
 * 받아야 하고 그 엔드포인트엔 variant 필터가 없다.
 *
 * metadata 는 표시용 사본이라 원장과 어긋날 수 있지만, 스토어프론트가 손님에게 보여주는 값도
 * 같은 metadata 다. 어긋나면 어드민과 화면이 같이 틀리고 Medusa 의 일일 감사 잡이 그걸 잡는다.
 */
export function toTimeSaleRows(products: RawProduct[]): TimeSaleRow[] {
  return products.flatMap((product) =>
    product.variants.map((variant) => {
      const base = (variant.prices ?? []).find(
        (price) => !price.price_list_id && price.currency_code === CURRENCY,
      );

      return {
        variantId: variant.id,
        productId: product.id,
        productTitle: product.title,
        variantTitle: variant.title,
        basePrice: base?.amount ?? 0,
        membershipBasePrice: toAmount(variant.metadata?.membershipPrice),
        generalSalePrice: null,
        membershipSalePrice: null,
      };
    }),
  );
}
