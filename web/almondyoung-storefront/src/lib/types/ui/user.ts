import type { UserBaseType } from "../common/users"
import type {
  AddressDto,
  BusinessInfoDto,
  ShopInfoDto,
  WishlistResponse,
} from "../dto/users"

export interface UserDetail extends UserBaseType {
  shop: ShopInfoType | null
  profile: Profile | null
}

export interface Profile extends UserBaseType {
  phoneNumber: string | null
  address: Address | null
  birthDate: Date | null
  profileImageUrl: string | null
  createdAt: Date
  updatedAt: Date
}

export type ShopInfoType = ShopInfoDto

export type Address = AddressDto

// --------------- 사업자 정보 관련 UI Type --------------
export interface BusinessInfo extends BusinessInfoDto {}

export interface WishlistItem extends WishlistResponse {}
