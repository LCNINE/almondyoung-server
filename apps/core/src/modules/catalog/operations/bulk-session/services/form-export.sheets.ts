/**
 * 워크북 열 하나의 정의. `key` 는 내부 식별자(파서·프리필이 공유), `label` 은 작업자가
 * 보는 한국어 헤더다. 파서는 **라벨 이름으로** 열을 찾으므로 열 순서는 자유이고
 * 모르는 열은 무시한다 — 작업자가 메모 열을 추가해도 안전하다.
 */
export interface ColumnDef {
  key: string;
  label: string;
  required: boolean;
  /** 허용값·빈칸 의미. 스킬이 읽는 열 문서에 그대로 실린다(form-export.columns-doc.ts). */
  note?: string;
}

/** 가격 룰이 임포트 표현 집합 밖을 때 판매가 칸에 넣는 값. 그대로면 "가격 변경 없음"이다. */
export const PRICING_SENTINEL = '[복합 가격규칙]';

export const SHEET_NAMES = {
  products: '상품',
  options: '옵션',
  variants: '조합',
  categories: '카테고리',
  constraints: '구매제약',
  images: '이미지',
  categoryReference: '카테고리 참조',
  /** exportId 를 담는 숨은 시트. 스펙의 "숨은 열"을 시트로 구현했다 — 열은 정렬·삭제로
   *  쉽게 유실되지만 시트는 훨씬 덜 건드려진다. */
  meta: '_양식정보',
} as const;

const req = (key: string, label: string, note?: string): ColumnDef => ({ key, label, required: true, note });
const opt = (key: string, label: string, note?: string): ColumnDef => ({ key, label, required: false, note });

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
  opt('isOverseas', '해외직구'),
  opt('isVisibleToMembersOnly', '멤버십회원전용노출'),
  opt('hideMembershipPriceForNonMembers', '비회원에게멤버십가숨김'),
  opt('isWholesaleOnly', '도매전용'),
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
  opt('preStockSellable', '선판매', 'Y 또는 N. 비우면 변경 없음(해제가 아니다).'),
  opt('alwaysSellableZeroStock', '항상판매', 'Y 또는 N. 비우면 변경 없음(해제가 아니다).'),
];

export const CATEGORY_COLUMNS: ColumnDef[] = [
  req('rowKey', '상품키'),
  req('categoryPath', '카테고리경로'),
  req('isPrimary', '대표여부'),
];

export const CONSTRAINT_COLUMNS: ColumnDef[] = [
  req('rowKey', '상품키'),
  opt('requiresMembership', '멤버십필요'),
  opt('lifetimeQuantityLimit', '평생구매한도'),
];

export const IMAGE_COLUMNS: ColumnDef[] = [req('imageKey', '이미지키'), req('sourceValue', '원본')];

export const CATEGORY_REFERENCE_COLUMNS: ColumnDef[] = [req('categoryPath', '카테고리경로')];

/** 테스트가 전 시트를 한 번에 도는 데 쓴다. */
export const ALL_COLUMN_SETS = [
  { name: '상품', columns: PRODUCT_COLUMNS },
  { name: '옵션', columns: OPTION_COLUMNS },
  { name: '조합', columns: VARIANT_COLUMNS },
  { name: '카테고리', columns: CATEGORY_COLUMNS },
  { name: '구매제약', columns: CONSTRAINT_COLUMNS },
  { name: '이미지', columns: IMAGE_COLUMNS },
  { name: '카테고리 참조', columns: CATEGORY_REFERENCE_COLUMNS },
];

export function labelsOf(columns: ColumnDef[]): string[] {
  return columns.map((c) => c.label);
}
