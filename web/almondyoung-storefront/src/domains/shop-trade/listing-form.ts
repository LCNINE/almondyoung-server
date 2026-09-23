import type {
  MemberShopListingPayload,
  MyShopListingResponseDto,
  ShopListingBusinessType,
  ShopListingDealType,
  ShopListingRegion,
} from "../../lib/types/dto/shop-listing"
import { formatPhone, isValidPhone, stripPhone } from "./phone"

// 서버 DTO(ugc MemberShopListingDto)와 같은 한계. 서버도 거르지만, 폼에서 먼저 막아 어느 칸인지 짚어 준다.
export const MAX_SHOP_LISTING_IMAGES = 15
const MAX_TITLE_LENGTH = 255
const MAX_CONTENT_LENGTH = 10_000
const MAX_KAKAO_URL_LENGTH = 255
const KAKAO_OPEN_CHAT_PREFIX = "https://open.kakao.com/"

/** 금액은 만원 단위 문자열로 받는다 (admin 폼과 같은 단위) */
export interface ShopListingFormValues {
  title: string
  content: string
  region: ShopListingRegion | ""
  businessType: ShopListingBusinessType | ""
  dealType: ShopListingDealType
  areaPyeong: string
  deposit: string
  monthlyRent: string
  keyMoney: string
  imageFileIds: string[]
  contactPhone: string
  kakaoOpenChatUrl: string
}

export type ShopListingFormField =
  | "title"
  | "region"
  | "businessType"
  | "imageFileIds"
  | "content"
  | "contactPhone"
  | "kakaoOpenChatUrl"

export const EMPTY_SHOP_LISTING_FORM: ShopListingFormValues = {
  title: "",
  content: "",
  region: "",
  businessType: "",
  dealType: "transfer",
  areaPyeong: "",
  deposit: "",
  monthlyRent: "",
  keyMoney: "",
  imageFileIds: [],
  contactPhone: "",
  kakaoOpenChatUrl: "",
}

const toWon = (manwon: string): number | null =>
  manwon.trim() === "" ? null : Number(manwon) * 10_000
const toManwon = (won: number | null): string =>
  won === null ? "" : String(won / 10_000)
const toInt = (value: string): number | null =>
  value.trim() === "" ? null : Number(value)

export function formValuesFromListing(
  listing: MyShopListingResponseDto
): ShopListingFormValues {
  return {
    title: listing.title,
    content: listing.content,
    region: listing.region ?? "",
    businessType: listing.businessType ?? "",
    dealType: listing.dealType ?? "transfer",
    areaPyeong: listing.areaPyeong === null ? "" : String(listing.areaPyeong),
    deposit: toManwon(listing.deposit),
    monthlyRent: toManwon(listing.monthlyRent),
    keyMoney: toManwon(listing.keyMoney),
    imageFileIds: listing.imageFileIds,
    contactPhone: listing.contactPhone ? formatPhone(listing.contactPhone) : "",
    kakaoOpenChatUrl: listing.kakaoOpenChatUrl ?? "",
  }
}

export type BuildMemberPayloadResult =
  | { ok: true; payload: MemberShopListingPayload }
  | { ok: false; field: ShopListingFormField }

/** 화면 위에서 아래 순서로 첫 문제 칸 하나를 돌려준다 */
export function buildMemberPayload(
  values: ShopListingFormValues
): BuildMemberPayloadResult {
  const title = values.title.trim()
  if (!title || title.length > MAX_TITLE_LENGTH) return { ok: false, field: "title" }
  if (!values.region) return { ok: false, field: "region" }
  if (!values.businessType) return { ok: false, field: "businessType" }
  if (
    values.imageFileIds.length === 0 ||
    values.imageFileIds.length > MAX_SHOP_LISTING_IMAGES ||
    new Set(values.imageFileIds).size !== values.imageFileIds.length
  )
    return { ok: false, field: "imageFileIds" }
  if (!values.content.trim() || values.content.length > MAX_CONTENT_LENGTH)
    return { ok: false, field: "content" }

  const contactPhone = stripPhone(values.contactPhone)
  if (!isValidPhone(contactPhone)) return { ok: false, field: "contactPhone" }

  const kakao = values.kakaoOpenChatUrl.trim()
  if (kakao && !kakao.startsWith(KAKAO_OPEN_CHAT_PREFIX))
    return { ok: false, field: "kakaoOpenChatUrl" }
  if (kakao && kakao.length > MAX_KAKAO_URL_LENGTH)
    return { ok: false, field: "kakaoOpenChatUrl" }

  return {
    ok: true,
    payload: {
      title,
      content: values.content,
      region: values.region,
      businessType: values.businessType,
      dealType: values.dealType,
      areaPyeong: toInt(values.areaPyeong),
      deposit: toWon(values.deposit),
      monthlyRent: toWon(values.monthlyRent),
      keyMoney: toWon(values.keyMoney),
      imageFileIds: values.imageFileIds,
      contactPhone,
      kakaoOpenChatUrl: kakao || null,
    },
  }
}
