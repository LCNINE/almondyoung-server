import type {
  ProductImage,
  UpdateMasterVersionDto,
} from '@/lib/services/products/products-detail.types';

export const PRODUCT_ADDITIONAL_IMAGE_LIMIT = 5;

export type ProductImagesDetail = {
  source: 'master' | 'version';
  versionId: string | null;
  status: 'active' | 'inactive' | 'draft' | null;
  images: ProductImage[];
};

export type ProductImageFormValues = {
  representativeFileId: string | null;
  additionalImageFileIds: string[];
};

export function canEditProductImages(detail: ProductImagesDetail): boolean {
  return (
    detail.source === 'version' &&
    detail.status === 'draft' &&
    Boolean(detail.versionId)
  );
}

function sortImages(images: ProductImage[]): ProductImage[] {
  return [...images].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return a.sortOrder - b.sortOrder;
  });
}

export function splitProductImages(images: ProductImage[]): {
  representative: ProductImage | null;
  additional: ProductImage[];
} {
  const sorted = sortImages(images);
  const representative = sorted.find((image) => image.isPrimary) ?? null;
  return {
    representative,
    additional: sorted.filter((image) => !image.isPrimary),
  };
}

export function toProductImageFormValues(
  detail: ProductImagesDetail
): ProductImageFormValues {
  const { representative, additional } = splitProductImages(detail.images);

  return {
    representativeFileId: representative?.fileId ?? null,
    additionalImageFileIds: additional.map((image) => image.fileId),
  };
}

export function canAddAdditionalProductImage(fileIds: string[]): boolean {
  return fileIds.length < PRODUCT_ADDITIONAL_IMAGE_LIMIT;
}

export function toProductImageUpdateDto(
  values: ProductImageFormValues
): UpdateMasterVersionDto {
  if (values.additionalImageFileIds.length > PRODUCT_ADDITIONAL_IMAGE_LIMIT) {
    throw new Error('부가 이미지는 최대 5개까지 가능합니다.');
  }

  return {
    thumbnailFileId: values.representativeFileId,
    additionalImageFileIds: values.additionalImageFileIds,
  };
}
