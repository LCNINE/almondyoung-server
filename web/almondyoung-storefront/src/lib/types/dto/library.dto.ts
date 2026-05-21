/**
 * Core 의 `/library/ownerships` 응답 모양. Medusa 시절 응답(은닉된 file 정보 + base64
 * 다운로드)과 다르게, Core 는 ownership 행 + asset 요약 만 노출하고 다운로드는
 * binary stream 으로 별도 호출한다.
 */

export interface OwnershipAssetSummaryDto {
  id: string
  name: string
  description: string | null
  mimeType: string | null
  thumbnailUrl: string | null
}

export interface OwnershipResponseDto {
  id: string
  customerId: string
  assetId: string
  salesOrderId: string
  grantedAt: string
  exercisedAt: string | null
  asset: OwnershipAssetSummaryDto
}

export interface OwnershipListResponseDto {
  data: OwnershipResponseDto[]
  total: number
  skip: number
  take: number
}

export type OwnershipFilter = "all" | "new" | "used"
