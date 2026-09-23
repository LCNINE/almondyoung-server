import { describe, expect, it } from "vitest"
import type { MyShopListingResponseDto } from "../../lib/types/dto/shop-listing"
import {
  EMPTY_SHOP_LISTING_FORM,
  buildMemberPayload,
  formValuesFromListing,
  type ShopListingFormValues,
} from "./listing-form"

const FILE = "019f890e-dec0-7060-a32e-024c3e47c6be"

const valid: ShopListingFormValues = {
  ...EMPTY_SHOP_LISTING_FORM,
  title: " 강남 네일샵 ",
  content: "시설 좋아요",
  region: "seoul",
  businessType: "nail",
  dealType: "transfer",
  areaPyeong: "15",
  deposit: "2000",
  monthlyRent: "",
  keyMoney: "3000",
  imageFileIds: [FILE],
  contactPhone: "010-1234-5678",
  kakaoOpenChatUrl: " ",
}

describe("buildMemberPayload", () => {
  it("만원 → 원, 빈 칸 → null, 전화는 숫자만, 빈 오픈채팅은 null", () => {
    expect(buildMemberPayload(valid)).toEqual({
      ok: true,
      payload: {
        title: "강남 네일샵",
        content: "시설 좋아요",
        region: "seoul",
        businessType: "nail",
        dealType: "transfer",
        areaPyeong: 15,
        deposit: 20_000_000,
        monthlyRent: null,
        keyMoney: 30_000_000,
        imageFileIds: [FILE],
        contactPhone: "01012345678",
        kakaoOpenChatUrl: null,
      },
    })
  })

  it.each([
    [{ title: "  " }, "title"],
    [{ region: "" }, "region"],
    [{ businessType: "" }, "businessType"],
    [{ imageFileIds: [] }, "imageFileIds"],
    [{ imageFileIds: Array.from({ length: 16 }, (_, i) => `${i}`) }, "imageFileIds"],
    [{ imageFileIds: [FILE, FILE] }, "imageFileIds"],
    [{ content: " \n " }, "content"],
    [{ content: "가".repeat(10_001) }, "content"],
    [{ contactPhone: "" }, "contactPhone"],
    [{ contactPhone: "1234" }, "contactPhone"],
    [{ kakaoOpenChatUrl: "https://example.com" }, "kakaoOpenChatUrl"],
    [{ kakaoOpenChatUrl: "https://open.kakao.com/" + "a".repeat(240) }, "kakaoOpenChatUrl"],
  ] as const)("%j → %s 에서 멈춘다", (patch, field) => {
    expect(buildMemberPayload({ ...valid, ...patch } as ShopListingFormValues)).toEqual({ ok: false, field })
  })

  it("오픈채팅 주소는 그대로 싣는다", () => {
    const result = buildMemberPayload({
      ...valid,
      kakaoOpenChatUrl: "https://open.kakao.com/o/abc",
    })
    expect(result.ok && result.payload.kakaoOpenChatUrl).toBe(
      "https://open.kakao.com/o/abc"
    )
  })
})

describe("formValuesFromListing", () => {
  it("원 → 만원 문자열, 전화는 하이픈 표시, null 은 빈 칸", () => {
    const listing = {
      title: "t",
      content: "c",
      region: "busan",
      businessType: "lash",
      dealType: "lease",
      areaPyeong: null,
      deposit: 5_000_000,
      monthlyRent: null,
      keyMoney: null,
      imageFileIds: [FILE],
      contactPhone: "0212345678",
      kakaoOpenChatUrl: null,
    } as unknown as MyShopListingResponseDto

    expect(formValuesFromListing(listing)).toEqual({
      title: "t",
      content: "c",
      region: "busan",
      businessType: "lash",
      dealType: "lease",
      areaPyeong: "",
      deposit: "500",
      monthlyRent: "",
      keyMoney: "",
      imageFileIds: [FILE],
      contactPhone: "02-1234-5678",
      kakaoOpenChatUrl: "",
    })
  })
})
