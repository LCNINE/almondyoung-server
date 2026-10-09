/**
 * 타임세일 도메인 규칙. 화면과 분리해 둔다 — 여기 있는 판정이 가격에 직결된다.
 *
 * 세일 저장은 Medusa `POST /admin/time-sales` 한 번이다. 리스트 분할·겹침 차단·가격 교체는 서버
 * 워크플로가 한다.
 */

export type TimeSaleStatus = 'draft' | 'scheduled' | 'active' | 'ended';

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

export function resolveTimeSaleStatus(
  period: TimeSalePeriod,
  now: Date,
  status: 'draft' | 'active' = 'active'
): TimeSaleStatus {
  if (status === 'draft') return 'draft';
  const start = Date.parse(period.startsAt);
  const end = Date.parse(period.endsAt);
  const at = now.getTime();

  if (at < start) return 'scheduled';
  if (at >= end) return 'ended';
  return 'active';
}

export const TIME_SALE_STATUS_LABEL: Record<TimeSaleStatus, string> = {
  draft: '비공개',
  scheduled: '예약',
  active: '진행중',
  ended: '종료',
};

/**
 * "정가의 N% 할인" 일괄 채우기.
 *
 * 각 할인율을 각자의 기준에 적용한다 — 일반은 정가에서, 멤버십은 멤버십가에서. 정가 기준 하나로
 * 양쪽을 채우면 멤버십 할인율이 N 보다 큰 상품이 전부 저장 거부된다.
 *
 * 멤버십 할인율은 따로 받는다. 같은 N 을 쓰면 이미 N% 이상 할인 중인 멤버십가(라이브 기준
 * 27,015 개 중 28%)는 세일가보다 싸서 Medusa 가 멤버십가를 그대로 적용한다 — 세일을 걸어도
 * 구독자에겐 값이 안 변한다. 생략하면 종전대로 같은 비율이다.
 */
export function applyPercentDiscount(
  rows: TimeSaleRow[],
  percent: number,
  membershipPercent: number = percent
): TimeSaleRow[] {
  const rate = 1 - percent / 100;
  const membershipRate = 1 - membershipPercent / 100;

  return rows.map((row) => ({
    ...row,
    generalSalePrice: Math.round(row.basePrice * rate),
    membershipSalePrice:
      row.membershipBasePrice === null ? null : Math.round(row.membershipBasePrice * membershipRate),
  }));
}

/**
 * 저장 가능한지.
 *
 * 세일가가 현재가보다 비싸면 뱃지만 붙고 가격은 그대로다 — "세일이라며 왜 그대로냐" CS 가 된다.
 * 화면에서 눈으로 비교되긴 하지만 상품이 스무 개면 놓친다.
 *
 * **빈 칸은 에러가 아니라 «그 품목은 세일에서 뺀다» 는 뜻이다.** 상품을 고르면 옵션이 백 개씩
 * 딸려오는데(라이브에 143 개짜리가 있다) 전부 채워야만 저장되면 "안 팔리는 옵션만 세일" 이
 * 불가능하고, 그렇게 만든 세일은 편집 화면에서 다시 저장할 수도 없다.
 */
export function validateRows(rows: TimeSaleRow[]): RowError[] {
  const errors: RowError[] = [];

  for (const row of rows) {
    if (row.generalSalePrice === null) {
      if (row.membershipSalePrice !== null) {
        errors.push({
          variantId: row.variantId,
          message: '일반 세일가를 비우면 이 품목은 세일에서 빠집니다. 멤버십 세일가도 비우세요.',
        });
      }
      continue;
    }
    // NaN·Infinity 를 먼저 쳐낸다. 뒤따르는 비교는 NaN 에서 전부 false 라, 걸러내지 않으면
    // 검증을 통과해 `amount: null` 로 직렬화된 가격이 Medusa 까지 간다.
    if (!Number.isFinite(row.generalSalePrice) || row.generalSalePrice <= 0) {
      errors.push({ variantId: row.variantId, message: '세일가는 0원보다 큰 숫자여야 합니다.' });
      continue;
    }
    if (row.generalSalePrice >= row.basePrice) {
      errors.push({
        variantId: row.variantId,
        message: `세일가는 정가(${row.basePrice.toLocaleString()}원)보다 낮아야 합니다.`,
      });
    }
    if (row.membershipBasePrice !== null && row.membershipSalePrice !== null) {
      if (!Number.isFinite(row.membershipSalePrice) || row.membershipSalePrice <= 0) {
        errors.push({
          variantId: row.variantId,
          message: '멤버십 세일가는 0원보다 큰 숫자여야 합니다.',
        });
      } else if (row.membershipSalePrice >= row.membershipBasePrice) {
        errors.push({
          variantId: row.variantId,
          message: `멤버십 세일가는 멤버십가(${row.membershipBasePrice.toLocaleString()}원)보다 낮아야 합니다.`,
        });
      }
    }
  }

  return errors;
}

/**
 * 실제로 세일에 들어가는 품목.
 *
 * 세일가를 비운 품목은 `buildTimeSaleWriteBody` 가 이미 빼고 있다. 중복 검사처럼 "이 세일이
 * 건드리는 품목" 을 묻는 쪽도 같은 기준을 써야 한다 — 고른 상품의 옵션 전부를 세면 세일가를
 * 넣지도 않은 품목 때문에 저장이 막힌다.
 */
export function saleVariantIds(rows: TimeSaleRow[]): string[] {
  return rows.filter((row) => row.generalSalePrice !== null).map((row) => row.variantId);
}

export type TimeSaleWriteBody = {
  title: string;
  starts_at: string;
  ends_at: string;
  status: 'draft' | 'active';
  general_prices: Array<{ variant_id: string; amount: number }>;
  membership_prices: Array<{ variant_id: string; amount: number }>;
};

/**
 * 편집 행 → 저장 요청 본문. 일반 세일가를 비운 품목은 세일에서 빠지고, 멤버십가가 없는 상품은 멤버십
 * 세일가도 만들지 않는다 (`validateRows` 와 같은 기준).
 */
export function buildTimeSaleWriteBody(params: {
  title: string;
  period: TimeSalePeriod;
  status: 'draft' | 'active';
  rows: TimeSaleRow[];
}): TimeSaleWriteBody {
  return {
    title: params.title.trim(),
    starts_at: params.period.startsAt,
    ends_at: params.period.endsAt,
    status: params.status,
    general_prices: params.rows
      .filter((row) => row.generalSalePrice !== null)
      .map((row) => ({ variant_id: row.variantId, amount: row.generalSalePrice as number })),
    membership_prices: params.rows
      .filter((row) => row.membershipBasePrice !== null && row.membershipSalePrice !== null)
      .map((row) => ({ variant_id: row.variantId, amount: row.membershipSalePrice as number })),
  };
}

const CURRENCY = 'krw';

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
