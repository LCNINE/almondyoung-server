import type {
  AddressDto,
  BusinessInfoDto,
  ShopInfoDto,
  UserDetailDto,
  WishlistResponse,
} from "../dto/users"

export interface UserDetail extends UserDetailDto {}

export type ShopInfoType = ShopInfoDto

export type Address = AddressDto

// --------------- 사업자 정보 관련 UI Type --------------
export interface BusinessInfo extends BusinessInfoDto {}

export interface WishlistItem extends WishlistResponse {}
