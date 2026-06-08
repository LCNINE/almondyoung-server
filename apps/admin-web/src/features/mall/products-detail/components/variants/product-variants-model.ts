import type {
  BulkUpdateProductVariantDto,
  ProductVariantRow,
  ProductVariantStatus,
  UpdateProductVariantDto,
} from '@/lib/services/products/products-detail.types';

export type ProductVariantsDetail = {
  source: 'master' | 'version';
  versionId: string | null;
  status: 'active' | 'inactive' | 'draft' | null;
};

export type ProductVariantFormValues = {
  variantName: string;
  status: ProductVariantStatus;
  displayOrder: string;
};

export function canEditProductVariants(detail: ProductVariantsDetail): boolean {
  return (
    detail.source === 'version' &&
    detail.status === 'draft' &&
    Boolean(detail.versionId)
  );
}

export function toProductVariantFormValues(
  variant: ProductVariantRow
): ProductVariantFormValues {
  return {
    variantName: variant.variantName ?? '',
    status: variant.status === 'inactive' ? 'inactive' : 'active',
    displayOrder:
      variant.displayOrder === null || variant.displayOrder === undefined
        ? ''
        : String(variant.displayOrder),
  };
}

function parseDisplayOrder(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error('표시 순서를 입력하세요.');
  }

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error('표시 순서는 0 이상의 숫자여야 합니다.');
  }
  return parsed;
}

function normalizeVariantStatus(status: string | null): ProductVariantStatus {
  return status === 'inactive' ? 'inactive' : 'active';
}

function normalizeVariantName(name: string | null): string {
  return (name ?? '').trim();
}

export function toProductVariantUpdateDto(
  variant: ProductVariantRow,
  values: ProductVariantFormValues
): UpdateProductVariantDto {
  const variantName = values.variantName.trim();
  const displayOrder = parseDisplayOrder(values.displayOrder);
  const dto: UpdateProductVariantDto = {};

  if (
    variantName &&
    variantName !== normalizeVariantName(variant.variantName)
  ) {
    dto.variantName = variantName;
  }
  if (values.status !== normalizeVariantStatus(variant.status)) {
    dto.status = values.status;
  }
  if (displayOrder !== variant.displayOrder) {
    dto.displayOrder = displayOrder;
  }

  return dto;
}

export function toBulkProductVariantUpdateDto(
  variants: ProductVariantRow[],
  values: Pick<UpdateProductVariantDto, 'status'>
): BulkUpdateProductVariantDto {
  return {
    updates: variants
      .filter(
        (variant) => values.status !== normalizeVariantStatus(variant.status)
      )
      .map((variant) => ({
        id: variant.id,
        status: values.status,
      })),
  };
}
