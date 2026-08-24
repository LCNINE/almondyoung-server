import {
  BannerDto,
  BannerGroupDto,
  CategoryTreeNodeDto,
  ProductDetailDto,
} from "../dto/pim"

export interface CategoryTree extends CategoryTreeNodeDto {}

export interface ProductDetail extends ProductDetailDto {}

// ==========================================
// Banner
// ==========================================
/**
 * BannerGroup
 */
export interface BannerGroup extends BannerGroupDto {}

/**
 * Banner
 */
export interface Banner extends BannerDto {}
