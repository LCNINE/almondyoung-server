// src/lib/types/dto/products.ts
// PIM API 스펙 기반 상품 관련 DTO 타입 정의

import type { UUID } from './common';

// ===== 공통 타입 =====
export type ProductStatus = 'active' | 'inactive' | 'draft' | 'archived';
export type ChannelType = string;
// 필요하면 UI 레벨에서만 선택지 상수로 제한
export const KNOWN_CHANNEL_TYPES = ['medusa', 'coupang', 'smartstore'] as const;
export type PricingStrategy = 'option_based' | 'variant_based';

// ===== 카테고리 관련 =====

export interface CreateCategoryDto {
  name: string;
  description?: string;
  slug?: string;
  imageUrl?: string;
  parentId?: string | null;
  sortOrder?: number;
}

export interface UpdateCategoryDto {
  name?: string;
  description?: string;
  slug?: string;
  imageUrl?: string;
  sortOrder?: number;
  isActive?: boolean;
  isVisibleToMembersOnly?: boolean;
}

export interface CategoryDto {
  id: string;
  name: string;
  description?: string;
  slug?: string;
  parentId?: string | null;
  level?: number;
  sortOrder?: number;
  isActive: boolean;
  /** 대표 이미지의 fileId (URL 아님). 없으면 null. */
  thumbnail?: string | null;
  /** 멤버십 회원에게만 노출하는 카테고리 여부 */
  isVisibleToMembersOnly?: boolean;
  createdAt: string;
  updatedAt: string;
  children?: CategoryDto[];
  path?: Array<{ id: string; name: string }>;
}

// 호환성을 위한 타입 별칭
export type CategoryResponseDto = CategoryDto;

export interface CategoryTreeResponseDto {
  categories: CategoryDto[];
  totalCount: number;
  maxDepth: number;
}

export interface CategoryPathResponseDto {
  categoryId: string;
  path: Array<{ id: string; name: string }>;
}

export interface MoveCategoryDto {
  newParentId?: string | null;
  sortOrder?: number;
}

// ===== 제품 마스터 관련 =====

/**
 * POST /masters only opens a product master and its initial draft version.
 * Product fields are edited later through version-scoped draft surfaces.
 */
export type CreateMasterDto = Record<string, never>;

export interface CreateMasterResponseDto {
  id: string;
  masterId: string;
  version: number;
  status: VersionStatus;
  name: string;
}

export interface UpdateMasterDto {
  name?: string;
  description?: string | null;
  descriptionHtml?: string | null;
  basePrice?: number;
  pricingStrategy?: PricingStrategy;
  brand?: string;
  status?: ProductStatus;
  images?: string[];
  specifications?: Record<string, string>;
  tags?: string[];
  /** 해외직구 상품 여부 — 주문 단계에서 개인통관고유부호 입력 필수. */
  isOverseas?: boolean;
}

/**
 * @deprecated 백엔드 `ProductMasterDto` 응답과 어긋남.
 * `basePrice`, `pricingStrategy`, `tags`, `categories`, `variants`,
 * `channelProducts`, `specifications` 는 백엔드 응답에 존재하지 않음 (phantom 필드).
 * 신규 코드는 `ProductMasterDetail` (lib/services/products/products-detail.types.ts) 사용.
 * 전체 정합 정비는 별도 PR — 기존 7+ 곳 consumer 동시 수정 필요.
 */
export interface MasterDto {
  id: string;
  name: string;
  description?: string;
  basePrice: number;
  pricingStrategy: PricingStrategy;
  brand?: string;
  status: ProductStatus;
  images?: string[];
  specifications?: Record<string, string>;
  tags?: string[];
  categories?: CategoryDto[];
  createdAt: string;
  updatedAt: string;
  variants?: VariantDto[];
  channelProducts?: ChannelProductDto[];
}

export interface MastersQuery {
  q?: string;
  /** @deprecated GET /masters uses q for keyword search. */
  search?: string;
  pricingStrategy?: PricingStrategy;
  brand?: string;
  categoryId?: string;
  status?: Extract<ProductStatus, 'active' | 'inactive' | 'draft'>;
  /** active(기본): active 버전만 / active-or-inactive: active 우선, 없으면 최신 inactive 포함 / all: draft만 있는 상품 포함 */
  mode?: 'active' | 'active-or-inactive' | 'all';
  productType?: 'regular_sale' | 'limited_edition';
  approvalStatus?: 'draft' | 'pending' | 'approved' | 'rejected';
  /** 등록자 UUID(user-service users.id). product_masters.createdBy 기준 */
  createdBy?: string;
  /** 공급처 UUID(suppliers.id). product_master_versions.supplierId 기준 */
  supplierId?: string;
  /** 등록일 범위 시작(ISO). product_masters.createdAt 기준 */
  createdFrom?: string;
  createdTo?: string;
  sort?: 'createdAt' | 'name' | 'updatedAt';
  order?: 'asc' | 'desc';
  /** 품절 상태 필터. in_stock=판매가능, partial=부분품절, sold_out=전체품절. all/미지정=필터 없음. */
  stock?: 'all' | 'in_stock' | 'partial' | 'sold_out';
  limit?: number;
  page?: number;
}

export interface MastersResponseDto {
  data: MasterDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/** GET /masters/selection — 필터에 걸린 상품 전량. 이름·썸네일은 없다. */
export interface MasterSelectionItemDto {
  masterId: string;
  hideMembershipPriceForNonMembers: boolean;
  isVisibleToMembersOnly: boolean;
  isOverseas: boolean;
}

export interface MasterSelectionResponseDto {
  items: MasterSelectionItemDto[];
  total: number;
}

// ===== 마스터 목록 요약 응답 (GET /masters - ProductSummaryDto) =====
// 백엔드 ProductSummaryDto 와 1:1 대응. 목록 API 가 실제로 반환하는 모양이다.

export interface PriceSummaryDto {
  minBasePrice: number;
  maxBasePrice: number;
  minMembershipPrice: number;
  maxMembershipPrice: number;
  hasTieredPrices: boolean;
}

export interface VariantPreviewDto {
  variantId: string;
  /** 수동 지정 이름이 없으면 옵션값 표시명을 이어 만든 이름. */
  name: string;
  /** 가격 캐시가 아직 없는 품목은 null. */
  basePrice: number | null;
  membershipPrice: number | null;
  status: string;
}

export interface MasterSummaryDto {
  masterId: string;
  versionId: string;
  name: string;
  /** 대표 이미지의 fileId. URL 아님 — file-service 경로로 변환 필요. */
  thumbnail: string | null;
  brand: string | null;
  /** 품번코드. 사람이 읽는 식별자 — masterId(UUID)와 다르다. */
  productCode: string | null;
  /** 공급가(매입 단가). 도매가가 아니다 — 도매 판매가는 아직 데이터가 없다. */
  supplyPrice: number | null;
  /** 공급처 ID. 이름은 inventory BC 소유라 목록 API 가 주지 않는다 — useSuppliers 로 매핑. */
  supplierId: string | null;
  /** 멤버십가 비공개 여부 — 비회원에게 멤버십가 숫자를 숨김. 상품 노출·구매 제한 아님. */
  hideMembershipPriceForNonMembers: boolean;
  /** 멤버십 회원 전용 노출 여부 — 비회원 목록·검색·상세에서 숨김. */
  isVisibleToMembersOnly: boolean;
  /** @deprecated use hideMembershipPriceForNonMembers */
  isMembershipOnly: boolean;
  /** 해외직구 상품 여부 — 체크아웃 시 개인통관고유부호 필수. (목록 API가 이미 반환) */
  isOverseas: boolean;
  status: ProductStatus;
  createdAt: string;
  /** 노출 중인 버전의 수정 시각. master 자체에는 updatedAt 이 없다. */
  updatedAt: string;
  optionGroupNames: string[];
  variantCount: number;
  /** 목록에 펼쳐 보여주는 품목 미리보기. 상품당 상한이 있어 variantCount 보다 적을 수 있다. */
  variantPreviews: VariantPreviewDto[];
  priceSummary: PriceSummaryDto | null;
  /** active 버전 품목 기준 품절 집계. none=판매가능, partial=부분품절, all=전체품절. */
  soldOutState: 'none' | 'partial' | 'all';
}

export interface MasterSummaryListResponseDto {
  data: MasterSummaryDto[];
  total: number;
  page: number;
  limit: number;
}

export interface PricePreviewDto {
  masterId: string;
  basePrice: number;
  calculatedPrice: number;
  pricingStrategy: PricingStrategy;
  appliedRules?: Array<{
    type: string;
    description: string;
    adjustment: number;
  }>;
}

export interface UpdatePricingStrategyDto {
  pricingStrategy: PricingStrategy;
  migrationData?: Record<string, string>;
}

// ===== 제품 변형 관련 =====

export interface CreateVariantDto {
  masterId: string;
  name: string;
  sku?: string;
  optionKey?: Record<string, string>;
  price?: number;
  status?: ProductStatus;
  images?: string[];
  specifications?: Record<string, string>;
  inventory?: {
    trackQuantity: boolean;
    allowBackorder: boolean;
    minOrderQuantity?: number;
    maxOrderQuantity?: number;
  };
}

/**
 * @deprecated 백엔드 `VariantWithPriceDto` 응답과 어긋남.
 * `name`, `sku`, `optionKey`, `images`, `specifications`, `inventory` 는 백엔드 응답에 존재하지 않음 (phantom 필드).
 * 백엔드 응답의 실제 필드는 `variantName`, `imageId`, `displayOrder`, `isDefault`, `optionValues` 등.
 * 신규 코드는 `ProductVariantRow` (lib/services/products/products-detail.types.ts) 사용.
 */
export interface VariantDto {
  id: string;
  masterId: string;
  master?: MasterDto;
  name: string;
  sku?: string;
  optionKey?: Record<string, string>;
  price?: number;
  calculatedPrice?: number;
  status: ProductStatus;
  images?: string[];
  specifications?: Record<string, string>;
  inventory?: {
    trackQuantity: boolean;
    allowBackorder: boolean;
    minOrderQuantity?: number;
    maxOrderQuantity?: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface VariantsQuery {
  masterId: string;
  limit?: number;
  page?: number;
  includePrice?: boolean;
  status?: ProductStatus;
}

export interface VariantsResponseDto {
  data: VariantDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface VariantPriceDto {
  variantId: string;
  price: number;
  basePrice?: number;
  calculatedPrice: number;
  pricingStrategy: PricingStrategy;
  appliedRules?: Array<{
    type: string;
    description: string;
    adjustment: number;
  }>;
}

// ===== 판매 채널 관련 =====

export interface CreateChannelDto {
  type: ChannelType;
  name: string;
  description?: string;
  config?: Record<string, any>;
  isActive?: boolean;
}

export interface UpdateChannelDto {
  type?: ChannelType;
  name?: string;
  description?: string;
  config?: Record<string, any>;
  isActive?: boolean;
}

export interface ChannelDto {
  id: string;
  type: ChannelType;
  name: string;
  description?: string;
  config?: Record<string, any>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  channelProducts?: ChannelProductDto[];
}

export interface ChannelsQuery {
  limit?: number;
  page?: number;
  search?: string;
  type?: ChannelType;
  isActive?: boolean;
}

export interface ChannelsResponseDto {
  data: ChannelDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface ActiveChannelsResponseDto {
  channels: ChannelDto[];
}

export interface UpdateChannelStatusDto {
  isActive: boolean;
}

export interface ValidateChannelConfigDto {
  type: ChannelType;
  config: Record<string, string>;
}

export interface ChannelValidationResponseDto {
  isValid: boolean;
  errors: string[];
}

// ===== 채널별 제품 관련 =====

export interface CreateChannelProductDto {
  masterId: string;
  channelId: string;
  name?: string;
  description?: string;
  price?: number;
  isActive?: boolean;
  channelSpecificData?: Record<string, string>;
  images?: string[];
  specifications?: Record<string, string>;
}

export interface UpdateChannelProductDto {
  name?: string;
  description?: string;
  price?: number;
  isActive?: boolean;
  channelSpecificData?: Record<string, string>;
  images?: string[];
  specifications?: Record<string, string>;
}

export interface ChannelProductDto {
  id: string;
  masterId: string;
  master?: MasterDto;
  channelId: string;
  channel?: ChannelDto;
  name?: string;
  description?: string;
  price?: number;
  isActive: boolean;
  channelSpecificData?: Record<string, string>;
  images?: string[];
  specifications?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelProductsQuery {
  channelId: string;
  limit?: number;
  page?: number;
  search?: string;
  isActive?: boolean;
}

export interface ChannelProductsResponseDto {
  data: ChannelProductDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface MasterChannelProductsResponseDto {
  channelProducts: ChannelProductDto[];
}

export interface MergedChannelProductDto {
  master: MasterDto;
  channelProduct: ChannelProductDto;
  mergedData: {
    name: string;
    description?: string;
    price: number;
    images: string[];
    specifications: Record<string, string>;
    isActive: boolean;
  };
}

export interface UpdateChannelProductNameDto {
  name: string;
}

export interface UpdateChannelProductStatusDto {
  isActive: boolean;
}

// ===== 매칭 테이블용 특별 타입 =====

export interface MatchingTableRowDto {
  id: string;
  channelProduct: ChannelProductDto;
  variant?: VariantDto;
  matchedSku?: {
    skuId: string;
    quantity: number;
    barcode?: string;
  };
  orderInfo?: {
    quantity: number;
    salesAmount: number;
    recipient: string;
    orderDate: string;
  };
  matchingStatus: 'matched' | 'unmatched' | 'no_product';
  actions: {
    canMatch: boolean;
    canRematch: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canCreate: boolean;
  };
}

export interface MatchingTableResponseDto {
  data: MatchingTableRowDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

// ===== 기존 호환성 타입 (점진적 마이그레이션용) =====

// 기존 CategoryDto와의 호환성
export interface LegacyCategoryDto {
  id: string;
  name: string;
  slug: string;
  description?: string;
  parent_id?: string;
  level: number;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  children?: LegacyCategoryDto[];
}

// 기존 ProductDto와의 호환성
export interface LegacyProductDto {
  id: string;
  name: string;
  description?: string;
  price: number;
  category_id?: string;
  status: string;
  created_at: string;
  updated_at: string;
}

// 기존 VariantDto와의 호환성
export interface LegacyVariantDto {
  id: string;
  product_id: string;
  name: string;
  sku?: string;
  price?: number;
  status: string;
  created_at: string;
  updated_at: string;
}

// ===== 배너 그룹 관련 =====

export interface CreateBannerGroupDto {
  code: string;
  title: string;
  category?: string;
  pcWidth?: number;
  pcHeight?: number;
  mobileWidth?: number;
  mobileHeight?: number;
  description?: string;
  isActive?: boolean;
  sortOrder?: number;
  createdBy?: string;
}

export interface UpdateBannerGroupDto {
  title?: string;
  category?: string;
  pcWidth?: number;
  pcHeight?: number;
  mobileWidth?: number;
  mobileHeight?: number;
  description?: string;
  isActive?: boolean;
  sortOrder?: number;
  updatedBy?: string;
}

export interface BannerGroupDto {
  id: string;
  code: string;
  title: string;
  category?: string;
  pcWidth?: number;
  pcHeight?: number;
  mobileWidth?: number;
  mobileHeight?: number;
  description?: string;
  isActive: boolean;
  sortOrder?: number;
  createdBy?: string;
  updatedBy?: string;
  deletedAt?: string;
  deletedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BannerGroupListQuery {
  category?: string;
}

// ===== 배너 관련 =====

export interface CreateBannerDto {
  bannerGroupId: string;
  title: string;
  description?: string;
  pcImageFileId?: string;
  mobileImageFileId?: string;
  linkUrl?: string;
  linkedProductMasterIds?: string[];
  displayStartAt?: string;
  displayEndAt?: string;
  isActive?: boolean;
  sortOrder?: number;
  createdBy?: string;
}

export interface UpdateBannerDto {
  title?: string;
  description?: string;
  pcImageFileId?: string;
  mobileImageFileId?: string;
  linkUrl?: string;
  linkedProductMasterIds?: string[];
  displayStartAt?: string;
  displayEndAt?: string;
  isActive?: boolean;
  sortOrder?: number;
  updatedBy?: string;
}

export interface BannerDto {
  id: string;
  bannerGroupId: string;
  title: string;
  description?: string;
  pcImageFileId?: string;
  mobileImageFileId?: string;
  linkUrl?: string;
  linkedProductMasterIds?: string[];
  displayStartAt?: string;
  displayEndAt?: string;
  isActive: boolean;
  sortOrder?: number;
  createdBy?: string;
  updatedBy?: string;
  deletedAt?: string;
  deletedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BannerGroupWithBannersDto extends BannerGroupDto {
  banners: BannerDto[];
}

// ===== 공지사항 관련 =====

export interface CreateNoticeDto {
  title: string;
  content: string;
  category?: string;
  badge?: string;
  isPinned?: boolean;
  displayStartAt?: string;
  displayEndAt?: string;
  isActive?: boolean;
  sortOrder?: number;
  createdBy?: string;
}

export interface UpdateNoticeDto {
  title?: string;
  content?: string;
  category?: string;
  badge?: string | null;
  isPinned?: boolean;
  displayStartAt?: string;
  displayEndAt?: string;
  isActive?: boolean;
  sortOrder?: number;
  updatedBy?: string;
}

export interface NoticeDto {
  id: string;
  title: string;
  content: string;
  category: string;
  badge: string | null;
  isPinned: boolean;
  displayStartAt: string | null;
  displayEndAt: string | null;
  isActive: boolean;
  sortOrder: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ===== 팝업 공지 (site_popups) =====

export const SITE_POPUP_CONTENT_TYPES = ['rich_text', 'image'] as const;
export type SitePopupContentType = (typeof SITE_POPUP_CONTENT_TYPES)[number];

export const SITE_POPUP_PLACEMENTS = ['main', 'all', 'paths'] as const;
export type SitePopupPlacement = (typeof SITE_POPUP_PLACEMENTS)[number];

export const SITE_POPUP_AUDIENCES = ['all', 'guest', 'member', 'membership'] as const;
export type SitePopupAudience = (typeof SITE_POPUP_AUDIENCES)[number];

export const SITE_POPUP_DISMISS_MODES = ['none', 'today', 'days'] as const;
export type SitePopupDismissMode = (typeof SITE_POPUP_DISMISS_MODES)[number];

export interface SitePopupDto {
  id: string;
  title: string;
  contentType: SitePopupContentType;
  content: string | null;
  pcImageFileId: string | null;
  mobileImageFileId: string | null;
  imageAlt: string | null;
  linkUrl: string | null;
  noticeId: string | null;
  pcWidth: number | null;
  pcHeight: number | null;
  mobileWidth: number | null;
  mobileHeight: number | null;
  placement: SitePopupPlacement;
  placementPaths: string[];
  audience: SitePopupAudience;
  dismissMode: SitePopupDismissMode;
  dismissDays: number | null;
  dismissVersion: number;
  displayStartAt: string | null;
  displayEndAt: string | null;
  isActive: boolean;
  sortOrder: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSitePopupDto {
  title: string;
  contentType?: SitePopupContentType;
  content?: string;
  pcImageFileId?: string;
  mobileImageFileId?: string;
  imageAlt?: string;
  linkUrl?: string;
  noticeId?: string;
  pcWidth?: number;
  pcHeight?: number;
  mobileWidth?: number;
  mobileHeight?: number;
  placement?: SitePopupPlacement;
  placementPaths?: string[];
  audience?: SitePopupAudience;
  dismissMode?: SitePopupDismissMode;
  dismissDays?: number;
  displayStartAt?: string;
  displayEndAt?: string;
  isActive?: boolean;
  sortOrder?: number;
}

/** null 을 보내면 값을 비우고, 필드를 생략하면 기존 값을 유지한다. */
export interface UpdateSitePopupDto {
  title?: string;
  contentType?: SitePopupContentType;
  content?: string | null;
  pcImageFileId?: string | null;
  mobileImageFileId?: string | null;
  imageAlt?: string | null;
  linkUrl?: string | null;
  noticeId?: string | null;
  pcWidth?: number | null;
  pcHeight?: number | null;
  mobileWidth?: number | null;
  mobileHeight?: number | null;
  placement?: SitePopupPlacement;
  placementPaths?: string[];
  audience?: SitePopupAudience;
  dismissMode?: SitePopupDismissMode;
  dismissDays?: number | null;
  displayStartAt?: string | null;
  displayEndAt?: string | null;
  isActive?: boolean;
  sortOrder?: number;
}

export interface SitePopupListQuery {
  includeInactive?: boolean;
  isActive?: boolean;
  placement?: SitePopupPlacement;
  audience?: SitePopupAudience;
  q?: string;
}

export interface NoticeListQuery {
  category?: string;
  includeInactive?: boolean;
  isActive?: boolean;
  isPinned?: boolean;
  badge?: string;
  q?: string;
}

// ===== 샵매매 관련 =====

export const SHOP_LISTING_REGIONS = [
  'seoul',
  'gyeonggi',
  'incheon',
  'busan',
  'daegu',
  'gwangju',
  'daejeon',
  'ulsan',
  'sejong',
  'gangwon',
  'chungbuk',
  'chungnam',
  'jeonbuk',
  'jeonnam',
  'gyeongbuk',
  'gyeongnam',
  'jeju',
] as const;

export type ShopListingRegion = (typeof SHOP_LISTING_REGIONS)[number];

export const SHOP_LISTING_BUSINESS_TYPES = [
  'nail',
  'lash',
  'semi-permanent',
  'skincare',
  'hair',
  'waxing',
  'tattoo',
  'etc',
] as const;

export type ShopListingBusinessType =
  (typeof SHOP_LISTING_BUSINESS_TYPES)[number];

export const SHOP_LISTING_BUSINESS_TYPE_LABELS: Record<
  ShopListingBusinessType,
  string
> = {
  nail: '네일',
  lash: '속눈썹',
  'semi-permanent': '반영구',
  skincare: '피부관리',
  hair: '헤어',
  waxing: '왁싱',
  tattoo: '타투',
  etc: '기타',
};

export const SHOP_LISTING_DEAL_TYPES = ['transfer', 'lease'] as const;

export type ShopListingDealType = (typeof SHOP_LISTING_DEAL_TYPES)[number];

export const SHOP_LISTING_DEAL_TYPE_LABELS: Record<ShopListingDealType, string> =
  {
    transfer: '양도',
    lease: '임대',
  };

export const SHOP_LISTING_REGION_LABELS: Record<ShopListingRegion, string> = {
  seoul: '서울',
  gyeonggi: '경기',
  incheon: '인천',
  busan: '부산',
  daegu: '대구',
  gwangju: '광주',
  daejeon: '대전',
  ulsan: '울산',
  sejong: '세종',
  gangwon: '강원',
  chungbuk: '충북',
  chungnam: '충남',
  jeonbuk: '전북',
  jeonnam: '전남',
  gyeongbuk: '경북',
  gyeongnam: '경남',
  jeju: '제주',
};

export interface ShopListingDto {
  id: string;
  slug: string;
  title: string;
  content: string;
  region: ShopListingRegion | null;
  businessType: ShopListingBusinessType | null;
  dealType: ShopListingDealType | null;
  areaPyeong: number | null;
  deposit: number | null;
  monthlyRent: number | null;
  keyMoney: number | null;
  thumbnailFileId: string | null;
  /** 샵 사진 갤러리 fileId 목록. 배열 순서가 곧 노출 순서 */
  images: string[];
  isActive: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateShopListingDto {
  /** 비워두면 제목에서 자동 생성된다. */
  slug?: string;
  title: string;
  content: string;
  region: ShopListingRegion;
  businessType: ShopListingBusinessType;
  dealType: ShopListingDealType;
  areaPyeong?: number | null;
  deposit?: number | null;
  monthlyRent?: number | null;
  keyMoney?: number | null;
  thumbnailFileId: string;
  images?: string[];
  isActive?: boolean;
}

export interface UpdateShopListingDto {
  slug?: string;
  title?: string;
  content?: string;
  region?: ShopListingRegion;
  businessType?: ShopListingBusinessType;
  dealType?: ShopListingDealType;
  areaPyeong?: number | null;
  deposit?: number | null;
  monthlyRent?: number | null;
  keyMoney?: number | null;
  thumbnailFileId?: string;
  images?: string[];
  isActive?: boolean;
}

export interface ShopListingListQuery {
  includeInactive?: boolean;
  isActive?: boolean;
  q?: string;
}

// ===== 태그 그룹 관련 =====

export interface CreateTagGroupDto {
  name: string;
  description?: string;
  displayOrder?: number;
  isActive?: boolean;
}

export interface UpdateTagGroupDto {
  name?: string;
  description?: string;
  displayOrder?: number;
  isActive?: boolean;
}

export interface TagGroupDto {
  id: string;
  name: string;
  description?: string;
  displayOrder?: number;
  isActive: boolean;
  valueCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface TagGroupListQuery {
  isActive?: boolean;
}

// ===== 태그 값 관련 =====

export interface CreateTagValueDto {
  name: string;
  displayOrder?: number;
  isActive?: boolean;
}

export interface UpdateTagValueDto {
  name?: string;
  displayOrder?: number;
  isActive?: boolean;
}

export interface TagValueDto {
  id: string;
  groupId: string;
  groupName?: string;
  name: string;
  displayOrder?: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ===== 가격 관리 (Pricing) =====

export type PricingLayer = 'base_price' | 'membership_price' | 'tiered_price';
export type PricingScopeType = 'all_variants' | 'with_option' | 'variants';
export type PricingOperationType = 'offset' | 'scale' | 'override';
export type CustomerType = 'regular' | 'membership';

export interface PricingRuleResponseDto {
  id: string;
  layer: PricingLayer;
  order: number;
  scopeType: PricingScopeType;
  scopeTargetIds: string[] | null;
  operationType: PricingOperationType;
  operationValue: number;
  minQuantity: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface PricingRulesResponseDto {
  basePriceRules: PricingRuleResponseDto[];
  membershipPriceRules: PricingRuleResponseDto[];
  tieredPriceRules: PricingRuleResponseDto[];
}

export interface PricingRuleInput {
  order: number;
  layer: PricingLayer;
  scopeType: PricingScopeType;
  scopeTargetIds?: string[];
  operationType: PricingOperationType;
  operationValue: number;
  minQuantity?: number;
}

export interface ReplacePricingRulesDto {
  basePriceRules: PricingRuleInput[];
  membershipPriceRules: PricingRuleInput[];
  tieredPriceRules: PricingRuleInput[];
}

export interface CalculatePriceRequestDto {
  variantId: string;
  quantity?: number;
  customerType?: CustomerType;
}

export interface AppliedRuleDto {
  ruleId: string;
  layer: PricingLayer;
  order: number;
  scopeType: PricingScopeType;
  operationType: PricingOperationType;
  operationValue: number;
  priceBeforeRule: number;
  priceAfterRule: number;
}

export interface PriceBreakdownDto {
  initialPrice: number;
  afterBasePrice: number;
  afterMembershipPrice?: number;
  afterTieredPrice?: number;
}

export interface CalculatePriceResponseDto {
  variantId: string;
  price: number;
  totalPrice?: number;
  appliedRules: AppliedRuleDto[];
  priceBreakdown: PriceBreakdownDto;
}

export interface TieredPriceDto {
  minQuantity: number;
  price: number;
}

export interface VariantPriceSetDto {
  basePrice: number;
  membershipPrice: number;
  tieredPrices: TieredPriceDto[];
}

// ===== 버전 관련 =====

export type VersionStatus = 'draft' | 'active' | 'inactive';

export interface MasterVersionDto {
  id: string;
  masterId: string;
  version: number;
  status: VersionStatus;
  name: string;
  parentVersionId: string | null;
  children: MasterVersionDto[];
  createdAt: string;
  updatedAt: string;
  draftOwnerId?: string | null;
}

export interface CreateDraftVersionDto {
  parentVersionId?: string;
  copyMappings?: boolean;
}

export interface MyDraftListItem {
  masterId: string;
  versionId: string;
  name: string;
  thumbnail: string | null;
  brand: string | null;
  productType: string;
  status: 'draft';
  createdAt: string;
  updatedAt: string;
}

export interface MyDraftsQuery {
  page?: number;
  limit?: number;
  q?: string;
  sort?: 'updatedAt' | 'createdAt';
  order?: 'asc' | 'desc';
}

export interface MyDraftsResponse {
  data: MyDraftListItem[];
  total: number;
  page: number;
  limit: number;
}

// ===== 채널 리스팅 =====

export interface ChannelListingDto {
  id: string;
  variantId: string;
  salesChannelId: string;
  channelItemId: string;
  channelItemName: string | null;
  channelOptionName: string | null;
  channelPrice: number | null;
  channelProductUrl: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelSiteInfoDto {
  id: string;
  name: string;
  site: string;
}

export interface ChannelListingWithChannelDto {
  id: string;
  channelItemId: string;
  channelItemName: string | null;
  channelOptionName: string | null;
  channelPrice: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  channel: ChannelSiteInfoDto;
}

export interface ChannelListingListResponseDto {
  data: ChannelListingWithChannelDto[];
  total: number;
}

export interface CreateChannelListingDto {
  variantId: string;
  salesChannelId: string;
  channelItemId: string;
  channelItemName?: string;
  channelOptionName?: string;
  channelPrice?: number;
  channelProductUrl?: string;
}

export interface UpdateChannelListingDto {
  channelItemId?: string;
  channelItemName?: string;
  channelOptionName?: string;
  channelPrice?: number;
  channelProductUrl?: string;
}

// ===== 채널 카테고리 =====

export interface ChannelCategoryDto {
  id: string;
  name: string;
  description: string | null;
  displayOrder: number;
  channelCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelCategoryListResponseDto {
  data: ChannelCategoryDto[];
}

export interface CreateChannelCategoryDto {
  name: string;
  description?: string;
  displayOrder?: number;
}

export interface UpdateChannelCategoryDto {
  name?: string;
  description?: string;
  displayOrder?: number;
}

// ===== 일괄 작업 관련 =====

export interface BulkUpdateDto {
  productIds: string[];
  status?: 'active' | 'inactive';
  approvalStatus?: 'draft' | 'pending' | 'approved' | 'rejected';
  basePrice?: number;
  brand?: string;
  seller?: string;
}

export interface BulkDeleteDto {
  productIds: string[];
}

export interface BulkRestoreDto {
  productIds: string[];
}

export interface BulkOperationResultDto {
  success: boolean;
  affected: number;
}

export interface BulkUpdateFailureDto {
  masterId: string;
  name: string | null;
  reason: string;
}

// 백엔드 POST /masters/bulk/update 실제 응답 모양.
export interface BulkUpdateResultDto {
  updated: number;
  products: unknown[];
  /** status: 'active'(일괄 재공개) 경로에서만 채워진다 — 검증 실패한 상품 목록. */
  failed?: BulkUpdateFailureDto[];
}

export interface BulkUpdatePolicyDto {
  productIds: string[];
  hideMembershipPriceForNonMembers?: boolean;
  isVisibleToMembersOnly?: boolean;
  isOverseas?: boolean;
  /** null 이면 기본 배송비 그룹으로 되돌린다. */
  shippingGroupCode?: string | null;
}

// POST /masters/bulk/policy 응답 모양 (products 없음).
export interface BulkPolicyResultDto {
  updated: number;
  failed?: BulkUpdateFailureDto[];
}

// ===== 감사 로그 관련 =====

export interface AuditLogItemDto {
  id: string;
  productId: string;
  action: string;
  userId: string;
  createdAt: string;
}

export interface ProductAuditHistoryItemDto extends AuditLogItemDto {
  changes?: Record<string, { old: unknown; new: unknown }> | null;
}

// ===== 승인 관련 =====

export interface PendingApprovalDto {
  id: string;
  name: string;
  approvalStatus: string;
  submittedAt?: string;
  submittedBy?: string;
}

export interface ApprovalHistoryItemDto {
  id: string;
  productId: string;
  action: 'submit' | 'approve' | 'reject';
  actorId: string;
  comment?: string;
  reason?: string;
  createdAt: string;
}

export interface ApproveProductDto {
  comment?: string;
}

export interface RejectProductDto {
  reason: string;
}


// ===== 엑셀 내보내기 =====

export interface ExportColumnDto {
  /** 양식에 저장되는 식별자 — 서버 카탈로그와 값이 같아야 한다. */
  key: string;
  label: string;
}

export interface ExportColumnsResponseDto {
  columns: ExportColumnDto[];
  defaultKeys: string[];
}

/**
 * 내보내기 필터. MastersQuery 와 거의 같지만 supplierId 가 배열이다 —
 * 목록은 URL 이라 콤마 문자열, 내보내기는 JSON body 라 배열을 쓴다.
 */
export type ProductExportFiltersDto = Omit<
  MastersQuery,
  'supplierId' | 'page' | 'limit' | 'search' | 'pricingStrategy'
> & {
  supplierId?: string[];
};

export interface ProductExportRequestDto {
  /** 내보낼 열 key 순서. 생략하면 서버 기본 양식. */
  columns?: string[];
  /** 선택항목 다운로드 — masterId 배열. 지정하면 filters 는 무시된다. */
  ids?: string[];
  /** 검색결과 전체 다운로드 — 목록 화면과 같은 필터. */
  filters?: ProductExportFiltersDto;
}
