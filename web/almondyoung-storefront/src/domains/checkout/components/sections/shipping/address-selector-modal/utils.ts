import { HttpTypes } from "@medusajs/types"
import { buildAddressLine } from "@/lib/utils/address-line"

export const buildFullAddress = (
  address: HttpTypes.StoreCustomerAddress
): string => {
  return buildAddressLine({
    province: address.province,
    city: address.city,
    address1: address.address_1,
    address2: address.address_2,
  })
}

export const buildFullName = (
  address: HttpTypes.StoreCustomerAddress
): string => {
  return [address.first_name, address.last_name].filter(Boolean).join(" ")
}
