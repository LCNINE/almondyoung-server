const PUBLIC_ASSET_BASE_URL =
  "https://almondyoung-public.s3.ap-northeast-2.amazonaws.com/storefront"

export const ALMOND_YOUNG_PLAY_URL = "https://www.almondyoungplay.com/"
export const ALMOND_YOUNG_PLAY_IMAGE_URL = `${PUBLIC_ASSET_BASE_URL}/quick-links/amdp-logo-white.png`
export const DABEAU_URL = "https://dabeau.kr"
export const DABEAU_IMAGE_URL = `${PUBLIC_ASSET_BASE_URL}/quick-links/dabeau-2.png`
export const BEAUTY_EXAM_URL = "https://www.xn--ok0b94xilff7df2wpza.com/"
export const BEAUTY_EXAM_IMAGE_URL = "/images/miyong-pilgi-logo.png"
export const BEAUTYTOP_HREF = "/beautytop"
export const ALMOND_TEMPLATE_HREF = "/almond-template/landing"
export const ALMOND_TEMPLATE_IMAGE_URL = "/images/almond-template-palette.png"
export const MEMBERSHIP_HALL_HREF = "/membership-hall"

// 로고 색으로 다시 칠한 아이콘(public/images/category-icons). 바꾸면 버전을 올려 캐시를 끊는다
export const CATEGORY_ICON_VERSION = "20261106-1"

const categoryIcon = (key: string) =>
  `/images/category-icons/${key}.png?v=${CATEGORY_ICON_VERSION}`

export const CATEGORY_ICON_URLS: Record<string, string> = {
  "lash-perm": categoryIcon("lash-perm"),
  "lash-extension": categoryIcon("lash-extension"),
  "semi-permanent": categoryIcon("semi-permanent"),
  nail: categoryIcon("nail"),
  tattoo: categoryIcon("tattoo"),
  skincare: categoryIcon("skincare"),
  hair: categoryIcon("hair"),
  waxing: categoryIcon("waxing"),
  nomond: categoryIcon("nomond"),
  "shop-meal": categoryIcon("shop-meal"),
  "shop-trade": categoryIcon("shop-trade"),
}
