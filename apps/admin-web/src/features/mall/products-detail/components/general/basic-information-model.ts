import type {
  ProductDetailCategory,
  UpdateMasterVersionDto,
} from '@/lib/services/products/products-detail.types';

export type BasicInformationDetail = {
  source: 'master' | 'version';
  versionId: string | null;
  status: 'active' | 'inactive' | 'draft' | null;
  name: string;
  brand: string | null;
  supplierId?: string | null;
  supplyPrice?: number | null;
  marketPrice?: number | null;
  seoTitle: string | null;
  seoDescription: string | null;
  seoKeywords: string[] | null;
  isWholesaleOnly: boolean | null;
  isOverseas: boolean | null;
  hideMembershipPriceForNonMembers: boolean | null;
  isVisibleToMembersOnly: boolean | null;
  /** @deprecated use hideMembershipPriceForNonMembers */
  isMembershipOnly: boolean | null;
  fulfillmentKind: 'physical' | 'digital' | null;
  shippingGroupCode: string | null;
  productInfo: ProductInfoValues | null;
  categories: ProductDetailCategory[];
};

// 스토어프론트 상품 상세의 «상품정보» 표. 키 이름이 곧 표의 행이라 이름을 바꾸면 표가 빈다.
export type ProductInfoValues = {
  productNumber?: string;
  weight?: string;
  dimensions?: string;
  origin?: string;
  capacity?: string;
  expirationDate?: string;
  manufacturer?: string;
  material?: string;
  usage?: string;
};

export const PRODUCT_INFO_FIELDS: Array<{
  key: keyof ProductInfoValues;
  label: string;
  placeholder: string;
  multiline?: boolean;
}> = [
  { key: 'productNumber', label: '상품번호', placeholder: '예: MG-PIG-001' },
  { key: 'weight', label: '상품 무게', placeholder: '예: 79.1g' },
  {
    key: 'dimensions',
    label: '상품 규격',
    placeholder: '예: 직경 21.5mm × 길이 100mm',
  },
  { key: 'origin', label: '원산지', placeholder: '예: 대한민국' },
  { key: 'capacity', label: '용량', placeholder: '예: 50ml' },
  {
    key: 'expirationDate',
    label: '유효일자',
    placeholder: '예: 제조일로부터 30개월',
  },
  { key: 'manufacturer', label: '제조사', placeholder: '예: 미곤아카데미' },
  { key: 'material', label: '소재', placeholder: '예: 티타늄 합금' },
  {
    key: 'usage',
    label: '사용방법',
    placeholder: '사용 순서·주의사항',
    multiline: true,
  },
];

export type BasicInformationFormValues = {
  name: string;
  brand: string;
  supplierId?: string | null;
  /** 빈 문자열 = 미입력(null 로 저장). 0 원과 구분해야 한다. */
  supplyPriceText: string;
  marketPriceText: string;
  seoTitle: string;
  seoDescription: string;
  seoKeywordsText: string;
  isWholesaleOnly: boolean;
  isOverseas: boolean;
  hideMembershipPriceForNonMembers: boolean;
  isVisibleToMembersOnly: boolean;
  fulfillmentKind: 'physical' | 'digital';
  /** 빈 문자열 = 기본 배송비 그룹. */
  shippingGroupCode: string;
  productInfo: ProductInfoValues;
  categoryIds: string[];
  primaryCategoryId: string | null;
};

export type CategoryTreeItem = {
  id: string;
  name: string;
  slug?: string;
  parentId?: string | null;
  isActive: boolean;
  children?: CategoryTreeItem[];
};

export type SelectableCategory = {
  id: string;
  name: string;
  slug?: string;
  pathLabel: string;
  /** 조상→자신 순 카테고리명. 이름에 `/` 가 들어가도 안전하게 다시 이어붙일 수 있다. */
  pathSegments: string[];
  depth: number;
  parentId: string | null;
  isActive: boolean;
};

export function canEditBasicInformation(
  detail: BasicInformationDetail
): boolean {
  return (
    detail.source === 'version' &&
    detail.status === 'draft' &&
    Boolean(detail.versionId)
  );
}

export function toBasicInformationFormValues(
  detail: BasicInformationDetail
): BasicInformationFormValues {
  return {
    name: detail.name,
    brand: detail.brand ?? '',
    supplierId: detail.supplierId ?? null,
    supplyPriceText:
      detail.supplyPrice == null ? '' : String(detail.supplyPrice),
    marketPriceText:
      detail.marketPrice == null ? '' : String(detail.marketPrice),
    seoTitle: detail.seoTitle ?? '',
    seoDescription: detail.seoDescription ?? '',
    seoKeywordsText: detail.seoKeywords?.join(', ') ?? '',
    isWholesaleOnly: detail.isWholesaleOnly ?? false,
    isOverseas: detail.isOverseas ?? false,
    hideMembershipPriceForNonMembers:
      detail.hideMembershipPriceForNonMembers ??
      detail.isMembershipOnly ??
      false,
    isVisibleToMembersOnly: detail.isVisibleToMembersOnly ?? false,
    fulfillmentKind: detail.fulfillmentKind ?? 'physical',
    shippingGroupCode: detail.shippingGroupCode ?? '',
    productInfo: { ...(detail.productInfo ?? {}) },
    categoryIds: detail.categories.map((category) => category.id),
    primaryCategoryId:
      detail.categories.find((category) => category.isPrimary)?.id ?? null,
  };
}

function trimToNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function uniqueNonEmpty(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean))
  );
}

/** 빈 문자열/공백은 미입력(null). 정수 아니거나 음수면 null 로 떨어뜨린다. */
export function parseMoney(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed.replace(/,/g, ''));
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

export function parseSeoKeywords(value: string): string[] {
  return uniqueNonEmpty(value.split(/[,\n]/));
}

export function formatSelectedCategories(
  categories: ProductDetailCategory[]
): string {
  if (categories.length === 0) return '-';
  return categories.map((category) => category.name).join(', ');
}

export function flattenCategoryTree(
  categories: CategoryTreeItem[],
  parentPath: string[] = [],
  depth = 0
): SelectableCategory[] {
  return categories.flatMap((category) => {
    const path = [...parentPath, category.name];
    return [
      {
        id: category.id,
        name: category.name,
        slug: category.slug,
        pathLabel: path.join(' / '),
        pathSegments: path,
        depth,
        parentId: category.parentId ?? null,
        isActive: category.isActive,
      },
      ...flattenCategoryTree(category.children ?? [], path, depth + 1),
    ];
  });
}

/**
 * 빈 값은 키째로 빼서 저장한다 — 스토어프론트 표는 값이 없는 행을 빈칸으로 그린다.
 *
 * 한 칸도 안 채웠으면 `{}` 가 아니라 **null** 이다. 두 가지를 동시에 지킨다:
 * 이름만 고치고 저장한 상품이 `null → {}` 로 바뀌어 버전 비교에 «productInfo 변경됨»
 * 으로 잡히지 않고(비교가 `JSON.stringify` 라 `"null" !== "{}"` 다), 값이 있던 상품을
 * 전부 비워 저장하면 실제로 지워진다(키를 빼 버리면 옛 값이 그대로 남는다).
 */
export function toProductInfoDto(
  values: ProductInfoValues
): ProductInfoValues | null {
  const entries = PRODUCT_INFO_FIELDS.map(
    ({ key }) => [key, values[key]?.trim() ?? ''] as const
  ).filter(([, value]) => value.length > 0);
  return entries.length > 0
    ? (Object.fromEntries(entries) as ProductInfoValues)
    : null;
}

export function toBasicInformationUpdateDto(
  values: BasicInformationFormValues
): UpdateMasterVersionDto {
  const brand = values.brand.trim();
  const categoryIds = uniqueNonEmpty(values.categoryIds);
  const primaryCategoryId = values.primaryCategoryId;

  return {
    name: values.name.trim(),
    brand: brand.length > 0 ? brand : null,
    supplierId: values.supplierId ?? null,
    supplyPrice: parseMoney(values.supplyPriceText),
    marketPrice: parseMoney(values.marketPriceText),
    seoTitle: trimToNullable(values.seoTitle),
    seoDescription: trimToNullable(values.seoDescription),
    seoKeywords: parseSeoKeywords(values.seoKeywordsText),
    isWholesaleOnly: values.isWholesaleOnly,
    isOverseas: values.isOverseas,
    hideMembershipPriceForNonMembers: values.hideMembershipPriceForNonMembers,
    isMembershipOnly: values.hideMembershipPriceForNonMembers,
    isVisibleToMembersOnly: values.isVisibleToMembersOnly,
    fulfillmentKind: values.fulfillmentKind,
    shippingGroupCode: trimToNullable(values.shippingGroupCode),
    productInfo: toProductInfoDto(values.productInfo),
    categoryIds,
    primaryCategoryId:
      primaryCategoryId && categoryIds.includes(primaryCategoryId)
        ? primaryCategoryId
        : null,
  };
}
