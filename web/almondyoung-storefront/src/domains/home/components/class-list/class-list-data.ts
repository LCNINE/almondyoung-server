import type { StoreProduct } from "@medusajs/types"
import { toV1CardItem } from "../v1-card/v1-card-data"

export type ClassRegionTabKey =
  | "seoul"
  | "capital"
  | "chungcheong"
  | "gyeongsang"

/**
 * 지역 탭 = 클래스 카테고리의 지역 자식 카테고리 묶음.
 * 상품 제목 앞 [지역] 말머리도 함께 본다 (자식 카테고리에 안 붙은 상품 대비).
 */
export const CLASS_REGION_TABS: readonly {
  key: ClassRegionTabKey
  handles: readonly string[]
  keywords: readonly string[]
}[] = [
  { key: "seoul", handles: ["cafe24-cat-99"], keywords: ["서울", "마포"] },
  {
    key: "capital",
    handles: ["cafe24-cat-100", "cafe24-cat-173"],
    keywords: ["경기", "인천", "시흥"],
  },
  {
    key: "chungcheong",
    handles: ["cafe24-cat-102"],
    keywords: ["충북", "충남", "천안", "청주", "대전"],
  },
  {
    key: "gyeongsang",
    handles: ["cafe24-cat-104"],
    keywords: ["대구", "부산", "울산", "경남", "경북"],
  },
]

export type ClassRow = {
  id: string
  handle: string
  region: string
  title: string
  imageSrc: string
  price: number
  tabs: ClassRegionTabKey[]
}

const REGION_PREFIX = /^\s*\[([^\]]+)\]\s*(.*)$/

/** "[서울 강남] 속눈썹 원데이" → { region: "서울 강남", name: "속눈썹 원데이" } */
export function splitClassTitle(title: string): {
  region: string
  name: string
} {
  const match = title.match(REGION_PREFIX)

  if (!match) return { region: "", name: title.trim() }

  return { region: match[1].trim(), name: match[2].trim() || title.trim() }
}

export function toClassRow(
  product: StoreProduct,
  isMember: boolean
): ClassRow | null {
  const item = toV1CardItem(product, isMember)
  if (!item) return null

  const { region, name } = splitClassTitle(item.title)
  const categoryHandles = new Set(
    (product.categories ?? []).map((category) => category.handle)
  )

  const tabs = CLASS_REGION_TABS.filter(
    (tab) =>
      tab.handles.some((handle) => categoryHandles.has(handle)) ||
      tab.keywords.some((word) => region.includes(word))
  ).map((tab) => tab.key)

  return {
    id: item.id,
    handle: item.handle,
    region,
    title: name,
    imageSrc: item.imageSrc,
    price: item.price,
    tabs,
  }
}
