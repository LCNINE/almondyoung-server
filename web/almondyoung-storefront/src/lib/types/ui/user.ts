export interface User {
  id: string
  loginId: string
  username: string
  email: string
  isEmailVerified: boolean
  lastActivityAt: Date
  createdAt: Date
  updatedAt: Date
}

export interface UserDetail extends User {
  shop: Shop | null
  profile: Profile | null
}

export interface Profile extends User {
  phoneNumber: string | null
  address: Address | null
  birthDate: Date | null
  profileImageUrl: string | null
  createdAt: Date
  updatedAt: Date
}

export interface Shop {
  id: string
  userId: string
  isOperating: boolean // 운영 여부
  yearsOperating: number | null // 운영 연수
  shopType: "solo" | "small" | "large" | null // 상점 유형
  categories: string[] // 카테고리
  targetCustomers: unknown // 타겟 고객
  openDays: unknown // 영업 요일
  createdAt: Date
  updatedAt: Date
}

export interface Address {
  address_1: string // 주소 1 (기본주소)
  address_2?: string // 주소 2 (상세주소)
  city: string // 도시
  country_codeL: string // 국가 코드
  postal_code: string // 우편번호
  province?: string // 시/도
}
