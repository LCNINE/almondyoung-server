/**
 * 워크북 열 하나의 정의. `key` 는 내부 식별자(파서·프리필이 공유), `label` 은 작업자가
 * 보는 한국어 헤더다. 파서는 **라벨 이름으로** 열을 찾으므로 열 순서는 자유이고
 * 모르는 열은 무시한다 — 작업자가 메모 열을 추가해도 안전하다.
 */
export interface ColumnDef {
  key: string;
  label: string;
  required: boolean;
  /** 허용값·빈칸 의미. 스킬이 읽는 열 문서에 그대로 실리고, 양식의 헤더 칸 메모로도 달린다. */
  note?: string;
  /** 고를 수 있는 값. 양식의 데이터 행에 드롭다운으로 걸린다(빈칸은 늘 허용 — 빈칸의 뜻은 열마다 다르다). */
  choices?: readonly string[];
}

/** 가격 룰이 임포트 표현 집합 밖을 때 판매가 칸에 넣는 값. 그대로면 "가격 변경 없음"이다. */
export const PRICING_SENTINEL = '[복합 가격규칙]';

export const SHEET_NAMES = {
  products: '상품',
  options: '옵션',
  variants: '조합',
  categories: '카테고리',
  constraints: '구매제약',
  quantityDiscounts: '수량할인',
  images: '이미지',
  categoryReference: '카테고리 참조',
  /** exportId 를 담는 숨은 시트. 스펙의 "숨은 열"을 시트로 구현했다 — 열은 정렬·삭제로
   *  쉽게 유실되지만 시트는 훨씬 덜 건드려진다. */
  meta: '_양식정보',
} as const;

const req = (key: string, label: string, note?: string): ColumnDef => ({ key, label, required: true, note });
const opt = (key: string, label: string, note?: string): ColumnDef => ({ key, label, required: false, note });
const YES_NO = ['Y', 'N'] as const;
/** Y/N 칸 — 대문자 Y·N 만 받는다(검증기). 엑셀의 TRUE/FALSE 불리언 셀은 파서가 Y/N 으로 읽는다. */
const yn = (column: ColumnDef): ColumnDef => ({ ...column, note: column.note ?? 'Y 또는 N.', choices: YES_NO });

export const PRODUCT_COLUMNS: ColumnDef[] = [
  req('rowKey', '상품키'),
  req('name', '상품명'),
  req('basePrice', '판매가'),
  opt('membershipPrice', '멤버십가'),
  opt('productCode', '상품코드'),
  opt('brand', '브랜드'),
  opt('thumbnailImageKey', '대표이미지키'),
  opt('additionalImageKeys', '부가이미지키'),
  opt('description', '상세설명'),
  opt('alternativeName', '별칭'),
  opt('material', '소재'),
  opt('marketPrice', '시중가'),
  opt('supplyPrice', '공급가'),
  opt('productType', '상품유형'),
  opt('fulfillmentKind', '배송유형'),
  opt('salesClassification', '판매분류'),
  opt('purchaseClassification', '구매분류'),
  opt('ageRestriction', '연령제한'),
  opt('minQuantity', '최소구매수량'),
  opt('maxQuantity', '최대구매수량'),
  opt('seller', '판매처'),
  yn(opt('isOverseas', '해외직구')),
  yn(opt('isVisibleToMembersOnly', '멤버십회원전용노출')),
  yn(opt('hideMembershipPriceForNonMembers', '비회원에게멤버십가숨김')),
  yn(opt('isWholesaleOnly', '도매전용')),
  opt('seoTitle', 'SEO제목'),
  opt('seoDescription', 'SEO설명'),
  opt('seoKeywords', 'SEO키워드'),
  opt('salesStartDate', '판매시작'),
  opt('salesEndDate', '판매종료'),
];

export const OPTION_COLUMNS: ColumnDef[] = [
  req('rowKey', '상품키'),
  req('optionKey', '옵션키'),
  req('optionName', '옵션명'),
  req('optionValueKey', '옵션값키'),
  req('optionValueName', '옵션값명'),
  opt('optionSortOrder', '옵션정렬'),
  opt('colorCode', '색상코드'),
  opt('valueSortOrder', '값정렬'),
];

export const VARIANT_COLUMNS: ColumnDef[] = [
  req('rowKey', '상품키'),
  req('combination', '조합'),
  opt('combinationLabel', '조합명(참고용)'),
  opt('basePrice', '판매가'),
  opt('membershipPrice', '멤버십가'),
  opt('variantCode', '품목코드'),
  // ── 판매정책. 버전에 담기지 않고 발행 시점에 즉시 적용된다(설계 스펙 §2). ──
  opt(
    'availabilityOverride',
    '판매상태재정의',
    "'품절' 또는 '출시예정'. 값이 찍혀 있던 칸을 비우면 해제된다. 원래 비어 있던 칸은 변경 없음.",
  ),
  opt(
    'comingSoonDate',
    '출시예정일',
    "YYYY-MM-DD. 같은 행의 판매상태재정의가 '출시예정'일 때만 쓸 수 있다. 표시 전용이며 판매를 열지 않는다.",
  ),
  yn(opt('preStockSellable', '선판매', 'Y 또는 N. 비우면 변경 없음(해제가 아니다).')),
  yn(opt('alwaysSellableZeroStock', '항상판매', 'Y 또는 N. 비우면 변경 없음(해제가 아니다).')),
];

export const CATEGORY_COLUMNS: ColumnDef[] = [
  req('rowKey', '상품키'),
  req('categoryPath', '카테고리경로'),
  yn(req('isPrimary', '대표여부', '상품마다 대표 카테고리 한 행에만 Y, 나머지 행은 N 또는 빈칸.')),
];

export const CONSTRAINT_COLUMNS: ColumnDef[] = [
  req('rowKey', '상품키'),
  yn(opt('requiresMembership', '멤버십필요')),
  opt('lifetimeQuantityLimit', '평생구매한도'),
];

/** 수량 할인 구간 칸 수. 관리자 화면의 최대 구간 수(`MAX_QUANTITY_DISCOUNT_TIERS`)와 같다. */
export const QUANTITY_DISCOUNT_TIER_SLOTS = [1, 2, 3, 4, 5] as const;

export const quantityDiscountTierKeys = (slot: number) =>
  ({
    minQuantity: `tier${slot}MinQuantity`,
    regularRate: `tier${slot}RegularRate`,
    membershipRate: `tier${slot}MembershipRate`,
  }) as const;

/**
 * 상품마다 «조합이 빈 행»(기본 구간, 사용·기간) 하나와 옵션별 예외 행 여러 개. 한 상품의 행 묶음 전체가
 * 한 덩어리로 비교·저장된다 — 칸 하나만 고쳐도 그 상품의 표 전체가 새 표가 된다. 상품 행이 없으면 변경 없음.
 */
export const QUANTITY_DISCOUNT_COLUMNS: ColumnDef[] = [
  req('rowKey', '상품키'),
  opt(
    'combination',
    '조합',
    '비우면 기본 구간(예외로 고르지 않은 옵션 전부). 옵션마다 다르게 하려면 «조합» 시트의 조합 값을 그대로 붙여 넣는다. 조합 행의 구간 칸을 모두 비우면 그 옵션은 할인 없음.',
  ),
  opt('combinationLabel', '조합명(참고용)', '읽지 않는다. 어느 옵션인지 보이려고 채워 둔다.'),
  yn(opt('enabled', '사용', 'Y 또는 N. 비우면 Y. 조합이 빈 행에만 넣는다.')),
  opt('startsOn', '시작일', 'YYYY-MM-DD. 한국 시간 그날 0시부터. 비우면 바로 시작. 조합이 빈 행에만 넣는다.'),
  opt('endsOn', '종료일', 'YYYY-MM-DD. 한국 시간 그날 끝까지. 비우면 계속. 조합이 빈 행에만 넣는다.'),
  ...QUANTITY_DISCOUNT_TIER_SLOTS.flatMap((slot) => {
    const keys = quantityDiscountTierKeys(slot);
    return [
      opt(
        keys.minQuantity,
        `구간${slot}수량`,
        '2 이상 정수. 같은 옵션을 이 수량 이상 담으면 할인된다. 최대구매수량보다 크면 적용되지 않는다.',
      ),
      opt(
        keys.regularRate,
        `구간${slot}일반%`,
        '0~99 정수. 판매가 기준 할인율. 비우거나 0 이면 일반 고객은 이 구간 할인 없음. 0 이 아니면 앞 구간보다 커야 한다.',
      ),
      opt(
        keys.membershipRate,
        `구간${slot}멤버십%`,
        '0~99 정수. 멤버십가 기준 할인율. 비우거나 0 이면 멤버십 회원은 이 구간 할인 없음. 0 이 아니면 앞 구간보다 커야 한다.',
      ),
    ];
  }),
];

/** 수량할인 시트에서 빠지면 안 되는 열. 참고용 이름 열만 지워도 된다. */
export const QUANTITY_DISCOUNT_REQUIRED_KEYS = QUANTITY_DISCOUNT_COLUMNS.map((c) => c.key).filter(
  (key) => key !== 'combinationLabel',
);

export const IMAGE_COLUMNS: ColumnDef[] = [req('imageKey', '이미지키'), req('sourceValue', '원본')];

export const CATEGORY_REFERENCE_COLUMNS: ColumnDef[] = [req('categoryPath', '카테고리경로')];

/** 테스트가 전 시트를 한 번에 도는 데 쓴다. */
export const ALL_COLUMN_SETS = [
  { name: '상품', columns: PRODUCT_COLUMNS },
  { name: '옵션', columns: OPTION_COLUMNS },
  { name: '조합', columns: VARIANT_COLUMNS },
  { name: '카테고리', columns: CATEGORY_COLUMNS },
  { name: '구매제약', columns: CONSTRAINT_COLUMNS },
  { name: '수량할인', columns: QUANTITY_DISCOUNT_COLUMNS },
  { name: '이미지', columns: IMAGE_COLUMNS },
  { name: '카테고리 참조', columns: CATEGORY_REFERENCE_COLUMNS },
];

export function labelsOf(columns: ColumnDef[]): string[] {
  return columns.map((c) => c.label);
}
