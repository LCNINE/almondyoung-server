import { z } from "zod"
import type { SupportedLocale } from "@/lib/utils/locale-path"
import { EditAddressState } from "../../domains/checkout/components/sections/shipping/types"

/**
 * 폼 데이터 모델 (Medusa 표준 주소 필드 superset).
 * locale 별로 실제 사용/검증하는 필드만 다르다.
 * - ko: name(단일) 사용, firstName/lastName/city/province 미사용
 * - en/ja: firstName/lastName/city/province 사용, name 미사용
 */
export interface ShippingAddressFormData {
  addressName?: string
  name?: string
  firstName?: string
  lastName?: string
  phone: string
  postalCode: string
  address1: string
  address2?: string
  city?: string
  province?: string
  saveAsDefault?: boolean
}

/** 호출부(useTranslations)에서 주입하는 검증 에러 메시지 */
export interface ShippingFormErrorMessages {
  name: string
  firstName: string
  lastName: string
  phoneRequired: string
  phoneInvalid: string
  postalCode: string
  address1: string
  city: string
  province: string
}

const KR_PHONE_REGEX = /^01[0-9]\d{7,8}$/
/** en/ja 전화 완화 검증: 숫자 최소 자릿수 */
const PHONE_MIN_DIGITS = 7

const isBlank = (value?: string): boolean => !value || value.trim().length === 0

/**
 * locale 별 배송지 폼 zod 스키마 빌더.
 * 모든 필드를 가진 단일 base 스키마에 superRefine 으로 locale 별 필수/형식 검증을 얹는다.
 */
export function buildShippingAddressSchema(
  locale: SupportedLocale,
  messages: ShippingFormErrorMessages
) {
  return z
    .object({
      addressName: z.string().optional(),
      name: z.string().optional(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      phone: z.string(),
      postalCode: z.string(),
      address1: z.string(),
      address2: z.string().optional(),
      city: z.string().optional(),
      province: z.string().optional(),
      saveAsDefault: z.boolean().optional(),
    })
    .superRefine((data, ctx) => {
      const addRequired = (path: keyof ShippingAddressFormData, message: string) =>
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message })

      // 공통 필수
      if (isBlank(data.postalCode)) addRequired("postalCode", messages.postalCode)
      if (isBlank(data.address1)) addRequired("address1", messages.address1)
      if (isBlank(data.phone)) addRequired("phone", messages.phoneRequired)

      const phoneDigits = (data.phone ?? "").replace(/\D/g, "")

      if (locale === "ko") {
        if (isBlank(data.name)) addRequired("name", messages.name)
        if (!isBlank(data.phone) && !KR_PHONE_REGEX.test(phoneDigits)) {
          addRequired("phone", messages.phoneInvalid)
        }
      } else {
        // en / ja: 이름·도시·지역 분리 필수, 전화는 형식 완화
        if (isBlank(data.firstName)) addRequired("firstName", messages.firstName)
        if (isBlank(data.lastName)) addRequired("lastName", messages.lastName)
        if (isBlank(data.city)) addRequired("city", messages.city)
        if (isBlank(data.province)) addRequired("province", messages.province)
        if (!isBlank(data.phone) && phoneDigits.length < PHONE_MIN_DIGITS) {
          addRequired("phone", messages.phoneInvalid)
        }
      }
    })
}

export interface ShippingAddressModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode?: "create" | "edit"
  addressId?: string
  defaultValues?: EditAddressState["defaultValues"]
  onSuccess?: () => void
}
