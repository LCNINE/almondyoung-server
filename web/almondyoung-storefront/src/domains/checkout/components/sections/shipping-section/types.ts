import { HttpTypes, StoreCartAddress } from "@medusajs/types"

export interface ShippingSectionProps {
  shippingAddress: StoreCartAddress | null
  addressName?: string | null
  shippingMemoType?: string | null
  shippingMemoCustom?: string | null
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
  }
}

export interface FormattedAddress {
  name: string
  phone: string
  fullAddress: string
}
