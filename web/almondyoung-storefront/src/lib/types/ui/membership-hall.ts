import type {
  MembershipHallCategoryCountDto,
  MembershipHallResponseDto,
  MembershipHallSortDto,
  MembershipHallTabDto,
} from "@/lib/types/dto/membership-hall"

export type MembershipHallTab = MembershipHallTabDto

export type MembershipHallSort = MembershipHallSortDto

export interface MembershipHallCategoryCount
  extends MembershipHallCategoryCountDto {}

export interface MembershipHallResult extends MembershipHallResponseDto {}
