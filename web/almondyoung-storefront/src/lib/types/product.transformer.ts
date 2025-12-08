// PIM DTO -> UI 타입 변환 전담 (순수 함수)
// - 네트워크 호출 금지
// - 폴백/파생값 계산 책임 (할인율, priceRange, 이미지 폴백 등)

import type {
  PimProductDetail,
  PimProductListItem,
  PimOptionGroup,
  PimVariant,
} from "@lib/types/dto/pim"
import type {
  ProductCard,
  ProductDetail,
  ProductOption,
  ProductOptionValue,
  PriceInfo,
  PriceRange,
} from "@lib/types/ui/product"
import type { ProductSearchItemDto } from "@lib/api/pim/pim-types"

type RawOpt = {
  optionGroupId?: string
  optionValueId?: string
  groupId?: string
  valueId?: string
  label?: string
  value?: string
}

type NormalizedOpt = {
  groupId: string
  valueId: string
  label?: string
  value?: string
}

function normalizeOpt(v: RawOpt): NormalizedOpt {
  return {
    groupId: v.groupId ?? v.optionGroupId ?? "",
    valueId: v.valueId ?? v.optionValueId ?? "",
    label: v.label,
    value: v.value,
  }
}

// ---------- 내부 유틸 ----------
const extractFirstImgFromHtml = (html?: string | null): string | undefined => {
  if (!html) return undefined
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i)
  return m?.[1]
}

const extractAllImgs = (html?: string | null): string[] => {
  if (!html) return []
  const matches: string[] = []
  let match
  const regex = /<img[^>]+src=["']([^"']+)["']/gi
  while ((match = regex.exec(html)) !== null) {
    matches.push(match[1])
  }
  return matches
}

const sanitizeAndRewrite = (
  html?: string | null,
  origin = "https://almondyoung.com"
): string | undefined => {
  if (!html) return undefined
  // 최소 방어. 실서비스는 DOMPurify 등 적용 권장
  const noScript = html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
  return noScript.replace(
    /src=["'](\/[^"]+)["']/g,
    (_m, path) => `src="${origin}${path}"`
  )
}

const pickPrimaryImage = (
  dto: PimProductDetail | PimProductListItem
): string => {
  return (
    (dto as any).thumbnail ||
    extractFirstImgFromHtml((dto as any).descriptionHtml) ||
    "/api/placeholder/240/240"
  )
}

const roundDiscount = (
  original?: number | null,
  member?: number | null
): number | undefined => {
  if (!original || !member || member >= original) return undefined
  return Math.round(((original - member) / original) * 100)
}

function makeOptionKey(parts: Record<string, string>): string {
  // 옵션 라벨/타입 name 정규화 + 소팅해서 순서 독립성 보장
  const norm = (s: string) => String(s).trim()
  return Object.entries(parts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${norm(k)}=${norm(v)}`)
    .join("|")
}

const computePriceRange = (
  base?: number | null,
  variants?: Pick<PimVariant, "priceAdjustment">[] | null
): PriceRange | undefined => {
  if (!base || !variants?.length) return undefined
  const prices = variants.map((v) => base + (v.priceAdjustment ?? 0))
  return { min: Math.min(...prices), max: Math.max(...prices) }
}

// --- price helper (상단에 배치)
function toPriceInfo(
  original?: number | null,
  member?: number | null,
  isMembership?: boolean | null
): PriceInfo {
  const safeOriginal = original ?? 0
  const safeMember = member ?? safeOriginal

  const discountRate =
    safeOriginal && safeMember && safeOriginal > safeMember
      ? Math.round(((safeOriginal - safeMember) / safeOriginal) * 100)
      : 0

  return {
    original: safeOriginal,
    member: safeMember !== safeOriginal ? safeMember : undefined,
    discountRate,
    isMembership: isMembership ?? null,
  }
}

/** PIM 옵션그룹 → UI 옵션 구조로 변환 */
/** PIM 옵션그룹 + 변형(variants) → UI 옵션 구조로 변환 */
function buildOptions(
  groups?: PimOptionGroup[] | null,
  variants?: PimVariant[] | null
): ProductOption[] {
  if (!groups?.length) return []

  // variantName → PimVariant 매핑 (대소문자/공백 무시)
  const norm = (s?: string | null) => (s ?? "").trim().toLowerCase()
  const variantByName = new Map<string, PimVariant>()
  for (const v of variants ?? []) {
    variantByName.set(norm(v.variantName), v)
  }

  return groups
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((g): ProductOption => {
      const label = g.displayName || g.name || "옵션"

      const values: ProductOptionValue[] = (g.values ?? [])
        .filter((v) => v.isActive !== false)
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map((v) => {
          // 옵션값 라벨(표시명/코드)을 variantName과 매칭 시도
          const display = v.displayName || v.value
          const matched = variantByName.get(norm(display))

          return {
            id: v.id, // 옵션값 ID
            name: display, // 버튼 라벨
            code: v.value, // 외부/연동 코드
            image: null, // 필요 시 variant 이미지 연결
            // ▼ 추가 필드 (옵션 값에 SKU/재고/추가금/비활성 상태 반영)
            sku: matched?.id, // ✅ 변형 ID를 SKU로 사용
            stock: undefined, // ✅ WMS 붙이면 서비스에서 주입
            priceDiff: matched?.priceAdjustment ?? 0, // ✅ 옵션가(+/-)
            disabled: matched?.status === "inactive", // ✅ 비활성 처리
          }
        })

      // UI 타입은 간단히 추론(필요 시 고도화)
      const uiType = /색|컬러|color/i.test(label)
        ? "color"
        : /사이즈|size/i.test(label)
          ? "size"
          : "select"

      return { type: label, label, uiType, values }
    })
}
//-----------------------------------------------------------//

// 옵션 그룹 -> UI 옵션
// ---------- 목록용 ----------
export const toProductCard = (
  dto: PimProductListItem | PimProductDetail
): ProductCard => {
  const variants = (dto as any).variants ?? []
  const optionGroups = (dto as any).optionGroups ?? []

  const isSingle = !(optionGroups?.length > 0 || variants?.length > 1)

  const defaultSku = variants?.[0]?.id // 단일/다중 모두 첫 변형을 기본 값으로 둠

  return {
    id: dto.id,
    name: dto.name,
    brand: (dto as any).brand || undefined,
    thumbnail: pickPrimaryImage(dto),
    basePrice: dto.basePrice ?? undefined,
    membershipPrice: (dto as any).membershipPrice ?? dto.basePrice ?? 0,
    isMembershipOnly: !!(dto as any).isMembershipOnly,
    status: (dto as any).status, // status가 없으면 undefined, 컴포넌트에서 active로 간주
    tags: (dto as any).tags ?? [],
    stock: {},
    optionMeta: { isSingle },
    defaultSku, // ✅
  }
}

// ---------- 상세용 ----------
export const toProductDetail = (dto: PimProductDetail): ProductDetail => {
  const card = toProductCard(dto)
  const allFromHtml = extractAllImgs(dto.descriptionHtml)

  // thumbnails는 메인 썸네일만 포함 (descriptionHtml 이미지 제외)
  const thumbnails = [card.thumbnail].filter(Boolean)
  // 옵션그룹 → UI 옵션
  const options = buildOptions(dto.optionGroups)

  // skuIndex 만들기: variant.optionValues → label/value 매칭 필요
  const skuIndex: Record<string, string> = {}
  const groupById = new Map<string, { label: string; values: any[] }>()

  for (const g of dto.optionGroups ?? []) {
    groupById.set(g.id, {
      label: g.displayName || g.name,
      values: g.values ?? [],
    })
  }
  for (const v of dto.variants ?? []) {
    // 각 variant의 optionValues 배열을 옵션 라벨/디스플레이값으로 역매핑
    const parts: Record<string, string> = {}
    for (const ov of v.optionValues ?? []) {
      const g = groupById.get(ov.optionGroupId ?? "")
      const disp =
        g?.values?.find((x) => x.id === ov.optionValueId)?.displayName ||
        ov.value
      const label = g?.label || ov.label || ov.optionGroupId
      if (label && disp) parts[label] = disp
    }
    const key = makeOptionKey(parts)
    if (key) skuIndex[key] = v.id
  }

  // 할인율 계산
  const discountRate =
    card.basePrice &&
    card.membershipPrice &&
    card.basePrice > card.membershipPrice
      ? Math.round(
          ((card.basePrice - card.membershipPrice) / card.basePrice) * 100
        )
      : 0

  const result: ProductDetail = {
    ...card,
    thumbnails,
    originalPrice: card.basePrice,
    description: dto.description || undefined,
    descriptionHtml: sanitizeAndRewrite(dto.descriptionHtml),
    detailImages: allFromHtml, // descriptionHtml에서 추출한 이미지들을 detailImages에 설정
    memberPrices: dto.membershipPrice
      ? [
          {
            range: "1~∞",
            rate: discountRate,
            price: dto.membershipPrice,
          },
        ]
      : undefined,
    options, // ✅ 옵션 UI용
    skuIndex, // ✅ 조합→변형ID 맵
    // skuStock: 서비스에서 withStock일 때 주입
    shipping: undefined,
    productInfo: undefined,
    categories: [],
    rating: dto.reviewSummary?.rating ?? 0,
    reviewCount: dto.reviewSummary?.reviewCount ?? 0,
    qnaCount: dto.reviewSummary?.qnaCount ?? 0,
    seo: {
      title: dto.seoTitle || dto.name,
      description: dto.seoDescription || undefined,
      keywords: dto.seoKeywords ?? undefined,
      slug: buildSlug(dto.name, dto.id),
    },
  }

  return result
}

const buildSlug = (name: string, id: string) =>
  `${name}`.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 64) +
  "-" +
  id.slice(0, 6)

// ---------- Elasticsearch 검색 결과용 ----------
/**
 * Elasticsearch 검색 결과를 ProductCard로 변환
 * ProductSearchItemDto -> ProductCard
 */
export const toProductCardFromSearch = (
  dto: ProductSearchItemDto
): ProductCard => {
  // 썸네일 추출 (description에서 이미지 추출 또는 기본값)
  const thumbnail =
    extractFirstImgFromHtml(dto.description) ||
    "/api/placeholder/240/240"

  // 태그를 문자열 배열로 변환
  const tags = dto.tags?.map((tag) => tag.value_name) || []

  return {
    id: dto.product_id || dto.master_id, // product_id 우선, 없으면 master_id
    name: dto.name,
    brand: dto.brand || undefined,
    thumbnail,
    basePrice: dto.price ?? undefined,
    membershipPrice: dto.price ?? undefined, // 검색 결과에는 멤버십 가격 정보가 없을 수 있음
    isMembershipOnly: false, // 검색 결과에는 멤버십 전용 정보가 없을 수 있음
    status: dto.status || "active",
    tags,
    stock: {},
    optionMeta: { isSingle: true }, // 검색 결과에는 옵션 정보가 없으므로 기본값
    createdAt: dto.created_at,
  }
}

