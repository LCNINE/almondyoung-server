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

export interface CreateBusinessInfoRequestDto {
  businessNumber: string
  representativeName: string
  fileUrl?: string
  metadata?: unknown
}

export interface UpdateBusinessInfoRequestDto {
  businessNumber?: string
  representativeName?: string
  fileUrl?: string
  metadata?: unknown
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
