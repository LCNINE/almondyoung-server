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
  seoTitle: string | null;
  seoDescription: string | null;
  seoKeywords: string[] | null;
  isWholesaleOnly: boolean | null;
  isMembershipOnly: boolean | null;
  fulfillmentKind: 'physical' | 'digital' | null;
  categories: ProductDetailCategory[];
};

export type BasicInformationFormValues = {
  name: string;
  brand: string;
  seoTitle: string;
  seoDescription: string;
  seoKeywordsText: string;
  isWholesaleOnly: boolean;
  isMembershipOnly: boolean;
  fulfillmentKind: 'physical' | 'digital';
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
    seoTitle: detail.seoTitle ?? '',
    seoDescription: detail.seoDescription ?? '',
    seoKeywordsText: detail.seoKeywords?.join(', ') ?? '',
    isWholesaleOnly: detail.isWholesaleOnly ?? false,
    isMembershipOnly: detail.isMembershipOnly ?? false,
    fulfillmentKind: detail.fulfillmentKind ?? 'physical',
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
    seoTitle: trimToNullable(values.seoTitle),
    seoDescription: trimToNullable(values.seoDescription),
    seoKeywords: parseSeoKeywords(values.seoKeywordsText),
    isWholesaleOnly: values.isWholesaleOnly,
    isMembershipOnly: values.isMembershipOnly,
    fulfillmentKind: values.fulfillmentKind,
    categoryIds,
    primaryCategoryId:
      primaryCategoryId && categoryIds.includes(primaryCategoryId)
        ? primaryCategoryId
        : null,
  };
}
