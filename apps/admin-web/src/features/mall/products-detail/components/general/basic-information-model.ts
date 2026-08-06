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
  categories: ProductDetailCategory[];
};

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
    supplyPriceText: detail.supplyPrice == null ? '' : String(detail.supplyPrice),
    marketPriceText: detail.marketPrice == null ? '' : String(detail.marketPrice),
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
    categoryIds,
    primaryCategoryId:
      primaryCategoryId && categoryIds.includes(primaryCategoryId)
        ? primaryCategoryId
        : null,
  };
}
