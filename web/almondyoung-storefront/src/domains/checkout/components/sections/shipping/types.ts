import { HttpTypes, StoreCartAddress } from "@medusajs/types"

export interface ShippingMemo {
  type: string
  custom: string
  hasEntrance: boolean
  entrancePassword: string
}

export interface ShippingSectionProps {
  cartId: string
  shippingAddress: StoreCartAddress | null
  addressName?: string | null
  shippingMemo: ShippingMemo
  onShippingMemoChange: (memo: ShippingMemo) => void
  /** 값이 바뀔 때마다 배송메모 편집 창을 검증 상태로 연다. */
  memoPromptKey?: number
}

export interface EditAddressState {
  address: HttpTypes.StoreCustomerAddress
  defaultValues: {
    addressName?: string
    name: string
    firstName?: string
    lastName?: string
    phone: string
    postalCode: string
    address1: string
    address2: string
    city?: string
    province?: string
    isDefaultShipping: boolean
    metadata: Record<string, unknown>
  }
}

export interface FormattedAddress {
  name: string
  phone: string
  postalCode: string
  address1: string
  address2: string
  fullAddress: string
}
