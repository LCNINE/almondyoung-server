import { HttpTypes, StoreCartAddress } from "@medusajs/types"
import type { FormattedAddress } from "./types"

/**
 * 우선순위에 따라 자동 설정할 배송지를 선택합니다.
 * 1. 기본 배송지 (is_default_shipping)
 * 2. 배열의 첫 번째 주소
 * 3. null (주소록이 비어있는 경우)
 */
export const selectAutoFillAddress = (
  addresses: HttpTypes.StoreCustomerAddress[]
): {
  address: HttpTypes.StoreCustomerAddress | null
  reason: "default" | "first" | "none"
} => {
  if (!addresses || addresses.length === 0) {
    return { address: null, reason: "none" }
  }

  // 1순위: 기본 배송지
  const defaultAddress = addresses.find((addr) => addr.is_default_shipping)
  if (defaultAddress) {
    return { address: defaultAddress, reason: "default" }
  }

  // 2순위: 첫 번째 주소
  return { address: addresses[0], reason: "first" }
}

/**
 * 자동 채움 사유에 따른 안내 메시지
 */
export const getAutoFillMessage = (
  reason: "default" | "first" | "none"
): string => {
  switch (reason) {
    case "default":
      return "기본 배송지로 설정된 주소를 불러왔습니다."
    case "first":
      return "저장된 배송지를 불러왔습니다."
    default:
      return ""
  }
}

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

export const formatAddress = (
  address: StoreCartAddress | null
): FormattedAddress => {
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
