import type { ShippingAddressFormData } from "./schema"

/** 전화번호에서 숫자만 추출 */
export const extractPhoneNumbers = (value: string): string =>
  value.replace(/\D/g, "")

/** 이름을 firstName, lastName으로 분리 */
export const splitName = (
  name: string
): { firstName: string; lastName: string } => {
  const nameParts = name.trim().split(" ")
  return {
    firstName: nameParts[0] || "",
    lastName: nameParts.slice(1).join(" ") || "",
  }
}

/** 주소에서 province, city 추출 */
export const extractAddressParts = (
  address: string
): { province: string; city: string } => {
  const addressParts = address.split(" ")
  return {
    province: addressParts[0] || "",
    city: addressParts[1] || "",
  }
}

/** 폼 데이터를 API 요청 형식으로 변환 */
export const transformFormDataToAddress = (data: ShippingAddressFormData) => {
  const { firstName, lastName } = splitName(data.name)
  const { province, city } = extractAddressParts(data.address1)

  return {
    address_name: data.addressName || undefined,
    first_name: firstName,
    last_name: lastName,
    phone: extractPhoneNumbers(data.phone),
    province,
    city,
    address_1: data.address1,
    address_2: data.address2 ?? "",
    postal_code: data.postalCode,
    country_code: "kr" as const,
  }
}
