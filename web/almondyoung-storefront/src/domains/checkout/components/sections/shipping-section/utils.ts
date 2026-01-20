import { StoreCartAddress } from "@medusajs/types"
import type { FormattedAddress } from "./types"

export const isValidAddress = (address: StoreCartAddress | null): boolean => {
  if (!address) return false

  const hasName = !!(address.first_name || address.last_name)
  const hasAddress = !!(
    address.province ||
    address.city ||
    address.address_1 ||
    address.address_2
  )
  const hasPhone = !!address.phone

  return hasName || hasAddress || hasPhone
}

export const formatPhoneNumber = (value: string): string => {
  const numbers = value.replace(/\D/g, "")
  if (numbers.length <= 3) return numbers
  if (numbers.length <= 7) return `${numbers.slice(0, 3)}-${numbers.slice(3)}`
  return `${numbers.slice(0, 3)}-${numbers.slice(3, 7)}-${numbers.slice(7, 11)}`
}

export const formatAddress = (address: StoreCartAddress | null): FormattedAddress => {
  if (!address) {
    return { name: "", phone: "", fullAddress: "" }
  }

  const name = [address.first_name, address.last_name].filter(Boolean).join(" ")
  const phone = address.phone ? formatPhoneNumber(address.phone) : ""
  const addressParts = [
    address.province,
    address.city,
    address.address_1,
    address.address_2,
  ].filter(Boolean)
  const fullAddress = addressParts.join(" ")

  return { name, phone, fullAddress }
}
