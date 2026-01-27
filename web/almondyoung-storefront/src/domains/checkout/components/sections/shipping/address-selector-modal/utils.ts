import { HttpTypes } from "@medusajs/types"

export const buildFullAddress = (
  address: HttpTypes.StoreCustomerAddress
): string => {
  return [address.province, address.city, address.address_1, address.address_2]
    .filter(Boolean)
    .join(" ")
}

export const buildFullName = (
  address: HttpTypes.StoreCustomerAddress
): string => {
  return [address.first_name, address.last_name].filter(Boolean).join(" ")
}
