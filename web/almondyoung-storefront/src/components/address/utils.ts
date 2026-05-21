import type { SupportedLocale } from "@/lib/utils/locale-path"
import { localeToCountryCode } from "@/lib/utils/locale-path"
import type { HttpTypes } from "@medusajs/types"
import type { ShippingAddressFormData } from "./schema"

/** 전화번호에서 숫자만 추출 */
export const extractPhoneNumbers = (value: string): string =>
  value.replace(/\D/g, "")

/** 이름을 firstName, lastName으로 분리 (ko 단일 입력 전용) */
export const splitName = (
  name: string
): { firstName: string; lastName: string } => {
  const nameParts = name.trim().split(" ")
  return {
    firstName: nameParts[0] || "",
    lastName: nameParts.slice(1).join(" ") || "",
  }
}

/** 주소에서 province, city 추출 (ko Daum 주소 전용) */
export const extractAddressParts = (
  address: string
): { province: string; city: string } => {
  const addressParts = address.split(" ")
  return {
    province: addressParts[0] || "",
    city: addressParts[1] || "",
  }
}

/**
 * 폼 데이터를 Medusa 주소 페이로드로 변환한다.
 * - ko: 단일 name → splitName, Daum address1 → extractAddressParts (기존 추정 로직 유지)
 * - en/ja: firstName/lastName/city/province 를 입력값 그대로 1:1 매핑
 */
export const transformFormDataToAddress = (
  data: ShippingAddressFormData,
  locale: SupportedLocale
): HttpTypes.StoreCreateCustomerAddress => {
  const common = {
    address_name: data.addressName || undefined,
    phone: extractPhoneNumbers(data.phone),
    address_1: data.address1,
    address_2: data.address2 ?? "",
    postal_code: data.postalCode,
    country_code: localeToCountryCode(locale),
    metadata: {
      shipping_address_name: data.addressName || "",
    },
  }

  if (locale === "ko") {
    const { firstName, lastName } = splitName(data.name ?? "")
    const { province, city } = extractAddressParts(data.address1)
    return { ...common, first_name: firstName, last_name: lastName, province, city }
  }

  // en / ja: 입력값 직접 매핑 (추정 로직 없음)
  return {
    ...common,
    first_name: (data.firstName ?? "").trim(),
    last_name: (data.lastName ?? "").trim(),
    province: (data.province ?? "").trim(),
    city: (data.city ?? "").trim(),
  }
}
