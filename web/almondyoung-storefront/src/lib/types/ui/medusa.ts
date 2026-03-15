import {
  CustomerResponseDto,
  StoreCustomerWithGroupsResDto,
} from "../dto/medusa"

type Customer = CustomerResponseDto["customer"]

type StoreCustomerWithGroups = StoreCustomerWithGroupsResDto

export type { Customer, StoreCustomerWithGroups }
