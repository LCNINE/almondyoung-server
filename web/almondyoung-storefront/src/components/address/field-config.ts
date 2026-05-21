import type { SupportedLocale } from "@/lib/utils/locale-path"

/** 배송지 폼에서 노출 가능한 필드 키 (폼 데이터 모델과 1:1) */
export type AddressFieldKey =
  | "addressName"
  | "name"
  | "firstName"
  | "lastName"
  | "phone"
  | "postalCode"
  | "address1"
  | "address2"
  | "city"
  | "province"

export interface LocaleAddressConfig {
  /** 렌더 순서대로 노출할 필드 목록 */
  fields: AddressFieldKey[]
  /** 우편번호 검색(Daum) 버튼 노출 여부 (ko 전용) */
  postalCodeSearch: boolean
  /** 기본주소를 검색으로만 채우는지 (read-only) */
  address1ReadOnly: boolean
  /** 전화번호 자동 하이픈 포맷팅 여부 (ko 전용) */
  phoneAutoFormat: boolean
  /** 전화 입력 최대 길이 (자동 포맷 시에만 의미) */
  phoneMaxLength?: number
}

/**
 * locale 별 배송지 폼 구성.
 * - ko: 단일 "받는 분 이름" + Daum 우편번호 검색 (기존 UX 유지)
 * - en: First/Last name 분리, City/State 직접 입력
 * - ja: 姓/名 분리, 都道府県(province)/市区町村(city) 직접 입력
 *
 * country_code 는 여기서 중복 정의하지 않고 `localeToCountryCode(locale)` 를 사용한다.
 */
const ADDRESS_CONFIG: Record<SupportedLocale, LocaleAddressConfig> = {
  ko: {
    fields: ["addressName", "name", "phone", "postalCode", "address1", "address2"],
    postalCodeSearch: true,
    address1ReadOnly: true,
    phoneAutoFormat: true,
    phoneMaxLength: 13,
  },
  en: {
    fields: [
      "addressName",
      "firstName",
      "lastName",
      "phone",
      "postalCode",
      "address1",
      "address2",
      "city",
      "province",
    ],
    postalCodeSearch: false,
    address1ReadOnly: false,
    phoneAutoFormat: false,
  },
  ja: {
    fields: [
      "addressName",
      "lastName",
      "firstName",
      "phone",
      "postalCode",
      "province",
      "city",
      "address1",
      "address2",
    ],
    postalCodeSearch: false,
    address1ReadOnly: false,
    phoneAutoFormat: false,
  },
}

export function getAddressConfig(locale: SupportedLocale): LocaleAddressConfig {
  return ADDRESS_CONFIG[locale] ?? ADDRESS_CONFIG.ko
}
