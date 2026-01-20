import { HttpTypes } from "@medusajs/types"

export const formatPhoneNumber = (value: string): string => {
  const numbers = value.replace(/\D/g, "")
  if (numbers.length <= 3) return numbers
  if (numbers.length <= 7) return `${numbers.slice(0, 3)}-${numbers.slice(3)}`
  return `${numbers.slice(0, 3)}-${numbers.slice(3, 7)}-${numbers.slice(7, 11)}`
}

export const buildFullAddress = (address: HttpTypes.StoreCustomerAddress): string => {
  return [address.province, address.city, address.address_1, address.address_2]
    .filter(Boolean)
    .join(" ")
}

export const buildFullName = (address: HttpTypes.StoreCustomerAddress): string => {
  return [address.first_name, address.last_name].filter(Boolean).join(" ")
}
