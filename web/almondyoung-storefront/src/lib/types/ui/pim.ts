import { BannerDto, BannerGroupDto, CategoryTreeNodeDto } from "../dto/pim"

export interface CategoryTree extends CategoryTreeNodeDto {}

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
