export type MembershipHallTabDto = "all" | "sale" | "discount"

export type MembershipHallSortDto = "sales" | "discount" | "newest"

export interface MembershipHallQueryDto {
  tab: MembershipHallTabDto
  sort: MembershipHallSortDto
  /** 카테고리 handle 또는 id. 자손 카테고리까지 포함한다 */
  category?: string
  limit: number
  offset: number
}

export interface MembershipHallCategoryCountDto {
  id: string
  handle: string
  count: number
}

/** `GET /store/membership-hall` 응답 */
export interface MembershipHallResponseDto {
  total: number
  limit: number
  offset: number
  productIds: string[]
  counts: Record<MembershipHallTabDto, number>
  categories: MembershipHallCategoryCountDto[]
  hasMembershipSale: boolean
}
