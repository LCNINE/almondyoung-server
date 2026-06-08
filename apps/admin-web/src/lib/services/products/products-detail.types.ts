// 백엔드 응답 진실에 맞춰진 로컬 타입.
// 글로벌 MasterDto/VariantDto 는 백엔드 응답과 어긋나있어 사용하지 않는다.
// 정합 정비는 별도 후속 PR — 그때 이 파일은 글로벌 타입으로 흡수될 수 있다.
//
// 출처:
// - apps/core/.../dto/masters/master-response.dto.ts  (ProductMasterDto)
// - apps/core/.../dto/variants/variant-response.dto.ts (VariantWithPriceDto)

export type ProductOptionValue = {
  id: string;
  optionGroupId: string;
  displayName: string;
  sortOrder: number;
};

export type ProductOptionGroup = {
  id: string;
  displayName: string;
  sortOrder: number;
  values: ProductOptionValue[];
};

export type ProductImage = {
  id: string;
  fileId: string;
  isPrimary: boolean;
  sortOrder: number;
};

export type ProductDetailCategory = {
  id: string;
  name: string;
  slug: string;
  path: string;
  parentId: string | null;
  isActive: boolean;
  isPrimary: boolean;
};

export type ProductMasterDetail = {
  id: string;
  name: string;
  description: string | null;
  descriptionHtml: string | null;
  brand: string | null;
  status: string | null;
  isWholesaleOnly: boolean | null;
  isMembershipOnly: boolean | null;
  seoTitle: string | null;
  seoDescription: string | null;
  seoKeywords: string[] | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  categories: ProductDetailCategory[];
  optionGroups: ProductOptionGroup[];
  images: ProductImage[];
};

export type ProductVariantRow = {
  id: string;
  masterId: string;
  variantName: string | null;
  imageId: string | null;
  displayOrder: number | null;
  status: string | null;
  isDefault: boolean | null;
  createdAt: string;
  updatedAt: string;
  // /variants/masters/:id 응답은 { id, optionGroupId, createdAt } 만 — displayName 없음.
  // 사람이 읽을 옵션 라벨은 detail 엔드포인트에만 있어 현재 목록에서 의미있게 렌더링 불가.
  optionValues: Array<{ id: string; optionGroupId: string }>;
  price?: number;
};

export type ProductOptionDiffValueInput = {
  displayName: string;
  colorCode?: string;
  imageUrl?: string;
  sortOrder?: number;
};

export type ProductOptionDiff = {
  add?: Array<{
    displayName: string;
    description?: string;
    sortOrder?: number;
    values: ProductOptionDiffValueInput[];
  }>;
  modifyDisplay?: Array<{
    optionGroupId: string;
    displayName?: string;
    description?: string;
    sortOrder?: number;
    values?: Array<{
      optionValueId: string;
      displayName?: string;
      colorCode?: string;
      imageUrl?: string;
      sortOrder?: number;
    }>;
  }>;
  addValues?: Array<{
    optionGroupId: string;
    values: ProductOptionDiffValueInput[];
  }>;
  removeValues?: Array<{
    optionGroupId: string;
    optionValueIds: string[];
  }>;
  remove?: string[];
};

export type ProductVariantsResponse = {
  data: ProductVariantRow[];
  total: number;
  page: number;
  limit: number;
};

// 백엔드 GET /masters/:masterId/versions/:versionId 응답.
// 출처: apps/core/.../mappers/product-version.mapper.ts (toDetailResponseDto)
// 페이지가 실제로 소비하는 필드만 기록 (master 와 겹치는 핵심 + version 식별 필드).
// 글로벌 정합 정비는 별도 PR.
export type MasterVersionDetailDto = {
  id: string;
  masterId: string;
  version: number;
  status: 'draft' | 'active' | 'inactive';
  name: string;
  description: string | null;
  descriptionHtml: string | null;
  brand: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  seoKeywords: string[] | null;
  isWholesaleOnly: boolean | null;
  isMembershipOnly: boolean | null;
  parentVersionId: string | null;
  draftOwnerId: string | null;
  createdAt: string;
  updatedAt: string;
  categories: ProductDetailCategory[];
  images: ProductImage[];
  optionGroups: ProductOptionGroup[];
  variants: Array<{
    id: string;
    masterId?: string;
    variantName: string | null;
    imageId: string | null;
    displayOrder: number | null;
    status: string | null;
    isDefault: boolean | null;
    createdAt: string;
    updatedAt: string;
    optionValues: Array<{ id: string; optionGroupId: string }>;
    price?: number;
  }>;
};

export type UpdateMasterVersionDto = {
  name?: string;
  description?: string | null;
  descriptionHtml?: string | null;
  brand?: string | null;
  thumbnailFileId?: string | null;
  additionalImageFileIds?: string[];
  seoTitle?: string | null;
  seoDescription?: string | null;
  seoKeywords?: string[];
  categoryIds?: string[];
  primaryCategoryId?: string | null;
  isWholesaleOnly?: boolean;
  isMembershipOnly?: boolean;
  optionDiff?: ProductOptionDiff;
};
