import { ProductSummaryDto } from '../../core/products/dto/products/product-response.dto';

/**
 * 상품 목록 엑셀 내보내기 항목 카탈로그.
 *
 * 여기가 단일 소스다 — 프론트의 양식 편집기는 `GET /masters/export/columns` 로
 * 이 목록을 받아 쓰고, 내보내기는 요청된 key 순서대로 열을 만든다.
 * key 는 저장된 양식에 박히므로 **한 번 정하면 바꾸지 않는다**(label 은 바꿔도 된다).
 */
export type ExportRow = ProductSummaryDto & { supplierName: string | null };

export type ExportColumn = {
  key: string;
  label: string;
  width: number;
  value: (row: ExportRow) => string | number | Date | null;
};

const STATUS_LABELS: Record<string, string> = {
  active: '판매함',
  inactive: '판매안함',
  draft: '작성중',
};

const SOLD_OUT_LABELS: Record<string, string> = {
  none: '판매가능',
  partial: '부분품절',
  all: '품절',
};

const yn = (v: boolean | null | undefined) => (v ? 'Y' : 'N');

const range = (min: number | undefined, max: number | undefined) => {
  if (min == null || max == null) return null;
  return min === max ? min : `${min} ~ ${max}`;
};

export const EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'productCode', label: '품번코드', width: 16, value: (r) => r.productCode },
  { key: 'name', label: '상품명', width: 42, value: (r) => r.name },
  { key: 'brand', label: '브랜드', width: 16, value: (r) => r.brand },
  { key: 'supplierName', label: '공급처', width: 16, value: (r) => r.supplierName },
  { key: 'status', label: '판매상태', width: 10, value: (r) => STATUS_LABELS[r.status] ?? r.status },
  { key: 'soldOutState', label: '품절상태', width: 10, value: (r) => SOLD_OUT_LABELS[r.soldOutState] ?? r.soldOutState },
  { key: 'optionGroupNames', label: '옵션제목', width: 20, value: (r) => r.optionGroupNames.join(' / ') || null },
  { key: 'variantCount', label: '옵션수', width: 8, value: (r) => r.variantCount },
  { key: 'basePrice', label: '판매가', width: 14, value: (r) => range(r.priceSummary?.minBasePrice, r.priceSummary?.maxBasePrice) },
  {
    key: 'membershipPrice',
    label: '멤버십가',
    width: 14,
    value: (r) => range(r.priceSummary?.minMembershipPrice, r.priceSummary?.maxMembershipPrice),
  },
  { key: 'supplyPrice', label: '공급가', width: 14, value: (r) => r.supplyPrice },
  { key: 'hasTieredPrices', label: '수량별가격', width: 10, value: (r) => yn(r.priceSummary?.hasTieredPrices) },
  { key: 'isOverseas', label: '해외직구', width: 10, value: (r) => yn(r.isOverseas) },
  {
    key: 'hideMembershipPriceForNonMembers',
    label: '멤버십가 비공개',
    width: 14,
    value: (r) => yn(r.hideMembershipPriceForNonMembers),
  },
  { key: 'isVisibleToMembersOnly', label: '멤버십 전용 노출', width: 14, value: (r) => yn(r.isVisibleToMembersOnly) },
  { key: 'createdAt', label: '등록일시', width: 20, value: (r) => r.createdAt },
  { key: 'updatedAt', label: '수정일시', width: 20, value: (r) => r.updatedAt },
  { key: 'masterId', label: '상품 ID', width: 38, value: (r) => r.masterId },
  { key: 'versionId', label: '버전 ID', width: 38, value: (r) => r.versionId },
];

const BY_KEY = new Map(EXPORT_COLUMNS.map((c) => [c.key, c]));

/** 셀메이트 기본 양식 대응 — 양식을 안 고른 경우의 기본 열 구성. */
export const DEFAULT_COLUMN_KEYS = [
  'productCode',
  'name',
  'brand',
  'supplierName',
  'optionGroupNames',
  'variantCount',
  'basePrice',
  'membershipPrice',
  'supplyPrice',
  'status',
  'createdAt',
  'updatedAt',
];

/**
 * 요청된 key 목록을 컬럼으로 해석한다. 모르는 key 는 조용히 버린다 —
 * 저장된 양식에 지금은 없는 key 가 남아 있어도 내보내기가 실패하면 안 된다.
 */
export function resolveColumns(keys: string[] | undefined): ExportColumn[] {
  const requested = keys?.length ? keys : DEFAULT_COLUMN_KEYS;
  const resolved = requested.map((k) => BY_KEY.get(k)).filter((c): c is ExportColumn => c !== undefined);
  return resolved.length > 0 ? resolved : DEFAULT_COLUMN_KEYS.map((k) => BY_KEY.get(k)!);
}
