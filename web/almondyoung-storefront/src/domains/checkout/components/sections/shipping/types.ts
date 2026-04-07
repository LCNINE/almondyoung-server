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
}

export interface EditAddressState {
  address: HttpTypes.StoreCustomerAddress
  defaultValues: {
    addressName?: string
    name: string
    phone: string
    postalCode: string
    address1: string
    address2: string
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
