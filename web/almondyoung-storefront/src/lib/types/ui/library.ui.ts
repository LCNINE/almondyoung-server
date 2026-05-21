import type {
  OwnershipFilter,
  OwnershipResponseDto,
} from "@lib/types/dto/library.dto"

/**
 * UI 컴포넌트가 사용하는 ownership 표현. dto 와 1:1.
 * 향후 computed 필드가 필요해지면 여기서 확장.
 */
export interface DigitalAssetOwnership extends OwnershipResponseDto {}

export type DigitalAssetOwnershipFilter = OwnershipFilter
