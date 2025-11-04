import {
  UserDetailsResponseDto,
  ShopInfoDto,
  ProfileDto,
  AddressDto,
  CategoryInfoDto,
  RecentViewDto,
} from "@lib/types/dto/user"
import {
  UserBasicInfo,
  UserDetailInfo,
  UserShopInfo,
  UserAddress,
  UserPaymentMethod,
  UserCategoryInfo,
} from "@lib/types/ui/user"
import { RecentViewProductThumbnail } from "@lib/types/ui/product"

/**
 * AddressDto를 UserAddress로 변환
 */
export function toUserAddress(dto: AddressDto): UserAddress {
  return {
    id: dto.id,
    street: dto.street,
    city: dto.city,
    state: dto.state,
    postalCode: dto.postalCode,
    country: dto.country,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  }
}

/**
 * CategoryInfoDto를 UserCategoryInfo로 변환
 */
export function toUserCategoryInfo(dto: CategoryInfoDto): UserCategoryInfo {
  // 빈 객체나 필수 필드가 없는 경우 기본값 반환
  if (!dto || !dto.id || !dto.name) {
    console.warn('⚠️ [toUserCategoryInfo] 잘못된 카테고리 데이터:', dto)
    return {
      id: 'unknown',
      name: '알 수 없음'
    }
  }
  
  return {
    id: dto.id,
    name: dto.name,
  }
}

/**
 * 문자열을 UserCategoryInfo로 변환
 */
export function stringToUserCategoryInfo(categoryName: string): UserCategoryInfo {
  return {
    id: `cat-${categoryName}`, // 임시 ID 생성
    name: categoryName,
  }
}

/**
 * ShopInfoDto를 UserShopInfo로 변환
 */
export function toUserShopInfo(dto: ShopInfoDto): UserShopInfo {
  // 문자열 배열을 UserCategoryInfo 배열로 변환
  const validCategories = dto.categories
    ?.filter(category => category && category.trim()) // 빈 문자열 제거
    .map(stringToUserCategoryInfo) || []
  
  console.log('🔍 [toUserShopInfo] 원본 categories:', dto.categories)
  console.log('🔍 [toUserShopInfo] 변환된 categories:', validCategories)
  
  return {
    isOperating: dto.isOperating,
    yearsOperating: dto.yearsOperating,
    shopType: dto.shopType,
    categories: validCategories,
    targetCustomers: dto.targetCustomers,
    openDays: dto.openDays,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  }
}

/**
 * UserDetailsResponseDto를 UserBasicInfo로 변환
 */
export function toUserBasicInfo(dto: UserDetailsResponseDto): UserBasicInfo {
  return {
    id: dto.id,
    email: dto.email,
    name: dto.username,
    phone: dto.profile?.phoneNumber || undefined,
    profileImage: dto.profile?.profileImageUrl || undefined,
    birthDate: dto.profile?.birthDate || new Date(),
    isEmailVerified: dto.isEmailVerified,
    lastActivityAt: dto.lastActivityAt,
    shop: dto.shop ? toUserShopInfo(dto.shop) : {
      isOperating: false,
      yearsOperating: null,
      shopType: null,
      categories: [],
      targetCustomers: null,
      openDays: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    basicAddress: dto.profile?.address ? toUserAddress(dto.profile.address) : {
      id: '',
      street: '',
      city: '',
      state: '',
      postalCode: '',
      country: '',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    preferences: {
      marketingEmail: false, // 기본값, 실제로는 별도 API에서 가져와야 함
      marketingSms: false,
      pushNotifications: true,
    },
    membershipLevel: 'basic', // 기본값, 실제로는 membership 서비스에서 가져와야 함
    isMembership: false, // 기본값, 실제로는 membership 서비스에서 가져와야 함
  }
}

/**
 * UserDetailsResponseDto를 UserDetailInfo로 변환
 */
export function toUserDetailInfo(dto: UserDetailsResponseDto): UserDetailInfo {
  const basicInfo = toUserBasicInfo(dto)
  
  return {
    ...basicInfo,
    addressGroup: dto.profile?.address ? [toUserAddress(dto.profile.address)] : [],
    paymentMethods: [], // 기본값, 실제로는 payment 서비스에서 가져와야 함
    joinDate: dto.createdAt,
    // orderHistory: [], // 주문 이력은 별도 API에서 가져와야 함
    // wishlist: [], // 찜 목록은 별도 API에서 가져와야 함
    // recentViews: [], // 최근 본 상품은 별도 API에서 가져와야 함
  }
}

/**
 * 여러 사용자 정보를 일괄 변환
 */
export function toUserBasicInfoList(dtos: UserDetailsResponseDto[]): UserBasicInfo[] {
  return dtos.map(toUserBasicInfo)
}

/**
 * RecentViewDto -> RecentViewProductThumbnail 변환
 * 백엔드 DTO를 경량화된 UI 타입으로 변환
 */
export function toRecentViewProductThumbnail(dto: RecentViewDto): RecentViewProductThumbnail {
  return {
    productId: dto.productId,
    viewedAt: dto.createdAt, // 백엔드가 createdAt을 사용
    thumbnail: "" // PIM에서 채워야 함
  }
}

/**
 * 사용자 정보가 없는 경우 기본값 반환
 */
export function createEmptyUserBasicInfo(): UserBasicInfo {
  return {
    id: '',
    email: '',
    name: '',
    birthDate: new Date(),
    isEmailVerified: false,
    lastActivityAt: new Date(),
    shop: {
      isOperating: false,
      yearsOperating: null,
      shopType: null,
      categories: [],
      targetCustomers: null,
      openDays: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    basicAddress: {
      id: '',
      street: '',
      city: '',
      state: '',
      postalCode: '',
      country: '',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    preferences: {
      marketingEmail: false,
      marketingSms: false,
      pushNotifications: true,
    },
    membershipLevel: 'basic',
    isMembership: false,
  }
}
