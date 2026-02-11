import type { UserBaseType } from "../common/users"

export interface UserDetailDto extends UserBaseType {
  shop: ShopInfoDto | null
  profile: {
    phoneNumber: string | null
    address: AddressDto | null
    birthDate: Date | null
    profileImageUrl: string | null
    createdAt: Date
    updatedAt: Date
  } | null
}

export interface AddressDto {
  address_1: string // 주소 1 (기본주소)
  address_2?: string // 주소 2 (상세주소)
  city: string // 도시
  country_codeL: string // 국가 코드
  postal_code: string // 우편번호
  province?: string // 시/도
}

export interface WishlistDto {
  id: string
  productId: string
  createdAt: string
  updatedAt: string
  userId: string
}

/*───────────────────────────
 * 상점 정보
 *──────────────────────────*/
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
  remind_at: Date | null // 설문 알림 시간
}

/*───────────────────────────
 * 프로필 정보
 *──────────────────────────*/
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

/*───────────────────────────
 * 최근 본 상품
 *──────────────────────────*/
export interface RecentViewDto {
  id: string //최근 본 상품 ID
  userId: string //사용자 ID
  productId: string //상품 ID
  createdAt: string //생성 시간
  updatedAt: string //수정 시간
}

/*───────────────────────────
 * 최근 본 상품 응답
 *──────────────────────────*/
export interface RecentViewsResponseDto {
  items: RecentViewDto[] //최근 본 상품 목록
  total: number //전체 개수
  page: number //현재 페이지
  limit: number //페이지당 항목 수
}

/*───────────────────────────
 * 사업자 정보
 *──────────────────────────*/
export interface BusinessInfoDto {
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

export interface BusinessInfoRequestDto {
  businessNumber?: string
  representativeName?: string
  fileUrl?: string
  metadata?: unknown
  externalBusinessStatus?: boolean
}

/*───────────────────────────
 * 사업자 정보 외부 조회 응답
 *──────────────────────────*/
export interface ExternalBusinessInfoResponseDto {
  success: boolean
  data: BusinessInfoDto
}

/*───────────────────────────
 * 사업자 정보 외부 조회 요청
 *──────────────────────────*/
export interface ExternalBusinessInfoRequestDto {
  businessNumber: string
  representativeName: string
}

/*───────────────────────────
 * 유저 결제 등록 상태
 *──────────────────────────*/
export interface UserVerificationStatusDto {
  birthDate: "verified" | "none"
  phone: "verified" | "none"
  business: {
    status: "verified" | "rejected" | "under_review" | "none"
    rejectionReason: string | null
  }
}

/*───────────────────────────
 * 휴대폰 인증번호 발송 요청
 *──────────────────────────*/
export type SendTwilioMessageDto = {
  countryCode: string
  phoneNumber: string
  purpose?: "forget_pin" | "phone_verify"
}

/*───────────────────────────
 * 휴대폰 인증번호 검증 요청
 *──────────────────────────*/
export type VerifyCodeDto = {
  code: string
  phoneNumber: string
}

/*───────────────────────────
 * 약관 동의 정보
 *──────────────────────────*/
export type CreateConsentsDto = {
  isOver14: boolean
  termsOfService: boolean
  electronicTransaction: boolean
  privacyPolicy: boolean
  thirdPartySharing: boolean
  marketingConsent: boolean
}

/*───────────────────────────
 * Wishlist
 *──────────────────────────*/
export interface WishlistDto {
  success: boolean
  data: {
    id: string
    productId: string
    createdAt: string
    updatedAt: string
    userId: string
  }[]
}

export interface WishlistResponse {
  id: string
  userId: string
  productId: string
  createdAt: string
  updatedAt?: string
}
