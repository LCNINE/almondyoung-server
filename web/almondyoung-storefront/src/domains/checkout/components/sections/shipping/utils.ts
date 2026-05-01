import { StoreCartAddress } from "@medusajs/types"
import type { FormattedAddress } from "./types"
import { formatPhoneNumber } from "@/lib/utils/format-phone-number"
import { buildAddressLine } from "@/lib/utils/address-line"

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

export const formatAddress = (
  address: StoreCartAddress | null
): FormattedAddress => {
  if (!address) {
    return {
      name: "",
      phone: "",
      postalCode: "",
      address1: "",
      address2: "",
      fullAddress: "",
    }
  }

  const name = [address.first_name, address.last_name].filter(Boolean).join(" ")
  const phone = address.phone ? formatPhoneNumber(address.phone) : ""
  const postalCode = address.postal_code ?? ""
  const address1 = address.address_1 ?? ""
  const address2 = address.address_2 ?? ""
  const fullAddress = buildAddressLine({
    province: address.province,
    city: address.city,
    address1,
    address2,
  })

  return { name, phone, postalCode, address1, address2, fullAddress }
}
