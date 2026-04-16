// --- 공통 ---

export type PaginatedResponse<T> = {
  data: T[]
  total: number
  page: number
  limit: number
}

// --- 상품 ---

export type PriceSummaryDto = {
  minBasePrice: number
  maxBasePrice: number
  minMembershipPrice: number
  maxMembershipPrice: number
  hasTieredPrices: boolean
}

export type ProductSummaryDto = {
  masterId: string
  versionId: string
  name: string
  thumbnail?: string
  brand?: string
  isMembershipOnly: boolean
  status: string
  createdAt: string
  optionGroupNames: string[]
  variantCount: number
  priceSummary?: PriceSummaryDto
}

export type ProductImageDto = {
  id: string
  fileId: string
  url?: string
  sortOrder: number
}

export type OptionGroupDto = {
  id: string
  name: string
  sortOrder: number
  values: OptionValueDto[]
}

export type OptionValueDto = {
  id: string
  value: string
  sortOrder: number
}

export type VariantDto = {
  id: string
  sku: string
  barcode?: string
  status: string
  optionValues: { groupName: string; value: string }[]
  price?: VariantPriceDto
}

export type VariantPriceDto = {
  basePrice: number
  membershipPrice: number
}

export type ProductDto = {
  id: string
  masterId: string
  version: number
  status: string
  name: string
  description?: string
  brand?: string
  thumbnail?: string
  images?: ProductImageDto[]
  seoTitle?: string
  seoDescription?: string
  seoKeywords?: string[]
  approvalStatus: string
  productType: string
  productCode?: string
  isWholesaleOnly: boolean
  isMembershipOnly: boolean
  createdAt: string
  updatedAt: string
  deletedAt?: string
  priceSummary?: PriceSummaryDto
  optionGroups?: OptionGroupDto[]
  variants?: VariantDto[]
}

export type ProductsQuery = {
  page?: number
  limit?: number
  categoryId?: string
  brand?: string
  name?: string
  mode?: string
  deleted?: string
  sort?: string
  order?: string
}

// --- 버전 ---

export type VersionTreeItem = {
  id: string
  version: number
  status: string
  parentVersionId?: string
  createdAt: string
  updatedAt: string
}

export type UpdateDraftDto = {
  name?: string
  description?: string
  brand?: string
  seoTitle?: string
  seoDescription?: string
  seoKeywords?: string[]
  isWholesaleOnly?: boolean
  isMembershipOnly?: boolean
  categoryIds?: string[]
  primaryCategoryId?: string
  tagValueIds?: string[]
  thumbnailFileId?: string
  additionalImageFileIds?: string[]
}

// --- 카테고리 ---

export type CategoryDto = {
  id: string
  name: string
  slug?: string
  description?: string
  imageUrl?: string
  parentId?: string
  sortOrder: number
  depth: number
  visible: boolean
  createdAt: string
  updatedAt: string
}

export type CategoryTreeNode = CategoryDto & {
  children: CategoryTreeNode[]
}

export type CategoryTreeResponseDto = {
  tree: CategoryTreeNode[]
  totalCount: number
}

export type CreateCategoryDto = {
  name: string
  description?: string
  slug?: string
  imageUrl?: string
  parentId?: string
  sortOrder?: number
}

export type UpdateCategoryDto = {
  name?: string
  description?: string
  slug?: string
  imageUrl?: string
  sortOrder?: number
}

// --- 태그 ---

export type TagGroupDto = {
  id: string
  name: string
  description?: string
  isActive: boolean
  createdAt: string
  updatedAt: string
  values?: TagValueDto[]
}

export type TagValueDto = {
  id: string
  groupId: string
  groupName?: string
  name: string
  createdAt: string
  updatedAt: string
}

export type CreateTagGroupDto = {
  name: string
  description?: string
  isActive?: boolean
}

export type CreateTagValueDto = {
  name: string
}
