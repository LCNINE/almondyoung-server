// Address DTO (백엔드에서 참조하는 타입)
export interface AddressDto {
  id: string
  street: string
  city: string
  state: string
  postalCode: string
  country: string
  createdAt: Date
  updatedAt: Date
}

export interface WishlistDto {
  id: string
  productId: string
  createdAt: string
  updatedAt: string
  userId: string
}

// 카테고리 정보 DTO
export interface CategoryInfoDto {
  id: string //카테고리 ID
  name: string //카테고리 이름
}

// 상점 정보 DTO
export interface ShopInfoDto {
  id: string //상점 ID
  userId: string //사용자 ID
  isOperating: boolean //운영 여부
  yearsOperating: number | null //운영 연수
  shopType?: "solo" | "small" | "large" | null //상점 유형
  categories: string[] //카테고리 정보 (문자열 배열 - 실제 백엔드 응답에 맞춤)
  targetCustomers: unknown //타겟 고객 정보
  openDays: unknown //영업일 정보
  createdAt: Date //상점 생성일
  updatedAt: Date
}

// 프로필 정보 DTO
export interface ProfileDto {
  id: string //프로필 ID
  userId: string //사용자 ID
  phoneNumber: string | null //전화번호
  address: AddressDto | null //주소 정보
  birthDate: Date | null //생년월일
  profileImageUrl: string | null //프로필 이미지 URL
  createdAt: Date //프로필 생성일
  updatedAt: Date //프로필 수정일
}

// 사용자 상세 정보 응답 DTO
export interface UserDetailsResponseDto {
  success: boolean
  data: {
    id: string //사용자 ID
    loginId: string //로그인 ID
    username: string //사용자 이름
    email: string //이메일
    isEmailVerified: boolean //이메일 인증 여부
    lastActivityAt: Date //마지막 활동 시간
    createdAt: Date //생성일
    updatedAt: Date //수정일
    shop: ShopInfoDto | null //상점 정보
    profile: ProfileDto | null //프로필 정보
  }
}

// 기본 사용자 응답 DTO
export interface UserResponseDto {
  id: string //사용자 ID
  loginId: string //로그인 ID
  username: string //사용자 이름
  email: string //이메일
  password: string | null
  isEmailVerified: boolean
  lastActivityAt: Date
  deletedAt: Date | null
  createdAt: Date //생성일
  updatedAt: Date //수정일
}

// 최근 본 상품 DTO (실제 DB구조)
export interface RecentViewDto {
  id: string //최근 본 상품 ID
  userId: string //사용자 ID
  productId: string //상품 ID
  createdAt: string //생성 시간
  updatedAt: string //수정 시간
}

// 최근 본 상품 추가 요청 DTO
export interface AddToRecentViewsDto {
  /** 상품 ID */
  productId: string
}

// 최근 본 상품 응답 DTO
export interface RecentViewsResponseDto {
  items: RecentViewDto[] //최근 본 상품 목록
  total: number //전체 개수
  page: number //현재 페이지
  limit: number //페이지당 항목 수
}

//동의사항-
export interface UserConsents {}

// --------------- 사업자 정보 관련 DTO --------------
export interface BusinessInfo {
  id: string
  userId: string
  shopId?: string | null
  businessNumber?: string | null // 사업자등록번호
  representativeName?: string | null // 대표자명
  reviewComment?: string | null // 관리자 리뷰 코멘트
  fileUrl?: string | null // 검증 파일
  status?: "under_review" | "approved" | "rejected" // 검증 상태
  metadata?: unknown // 메타데이터
  createdAt: Date
  updatedAt: Date
}

export interface BusinessInfoResponseDto {
  success: boolean
  data: BusinessInfo
}

export interface BusinessInfoRequestDto {
  businessNumber?: string
  representativeName?: string
  fileUrl?: string
  metadata?: unknown
  externalBusinessStatus?: boolean
}

/** 사업자 정보 외부 조회 응답 DTO */
export interface ExternalBusinessInfoResponseDto {
  success: boolean
  data: BusinessInfo
}

/** 사업자 정보 외부 조회 요청 DTO */
export interface ExternalBusinessInfoRequestDto {
  businessNumber: string
  representativeName: string
}

// --------------- 유저 결제 등록 상태 관련 DTO --------------
export interface UserVerificationStatusDto {
  birthDate: "verified" | "none"
  phone: "verified" | "none"
  business: {
    status: "verified" | "rejected" | "under_review" | "none"
    rejectionReason: string | null
  }
}
