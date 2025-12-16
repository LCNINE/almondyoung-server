// PIM DTO -> UI 타입 변환 전담 (순수 함수)
// - 네트워크 호출 금지
// - 폴백/파생값 계산 책임 (할인율, priceRange, 이미지 폴백 등)

import type {
  ProductDetailDto,
  ProductListItemDto,
  OptionGroupDto,
  OptionValueDto,
  VariantDto,
  ProductSearchItemDto,
} from "@lib/types/dto/pim"
import type {
  ProductCard,
  ProductDetail,
  ProductOption,
  ProductOptionValue,
  PriceInfo,
  PriceRange,
} from "@lib/types/ui/product"

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
  dto: ProductDetailDto | ProductListItemDto
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
  variants?: VariantDto[] | null
): PriceRange | undefined => {
  if (!base || !variants?.length) return undefined
  // VariantDto에는 priceAdjustment가 없으므로 기본값 0 사용
  const prices = variants.map((v) => base + 0)
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
  groups?: OptionGroupDto[] | null,
  variants?: VariantDto[] | null
): ProductOption[] {
  if (!groups?.length) return []

  // variantName → VariantDto 매핑 (대소문자/공백 무시)
  const norm = (s?: string | null) => (s ?? "").trim().toLowerCase()
  const variantByName = new Map<string, VariantDto>()
  for (const v of variants ?? []) {
    variantByName.set(norm(v.variantName), v)
  }

  return groups
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((g): ProductOption => {
      const label = g.displayName || "옵션"

      const values: ProductOptionValue[] = (g.values ?? [])
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map((v) => {
          // 옵션값 라벨(표시명/코드)을 variantName과 매칭 시도
          const display = v.displayName
          const matched = variantByName.get(norm(display))

          return {
            id: v.id, // 옵션값 ID
            name: display, // 버튼 라벨
            code: v.displayName, // 외부/연동 코드 (displayName 사용)
            image: null, // 필요 시 variant 이미지 연결
            // ▼ 추가 필드 (옵션 값에 SKU/재고/추가금/비활성 상태 반영)
            sku: matched?.id, // ✅ 변형 ID를 SKU로 사용
            stock: undefined, // ✅ WMS 붙이면 서비스에서 주입
            priceDiff: 0, // ✅ VariantDto에는 priceAdjustment가 없으므로 0
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
  dto: ProductListItemDto | ProductDetailDto
): ProductCard => {
  const variants = (dto as any).variants ?? []
  const optionGroups = (dto as any).optionGroups ?? []

  const isSingle = !(optionGroups?.length > 0 || variants?.length > 1)

  const defaultSku = variants?.[0]?.id // 단일/다중 모두 첫 변형을 기본 값으로 둠

  return {
    id: "id" in dto ? dto.id : dto.versionId, // ProductDetailDto는 id, ProductListItemDto는 versionId
    name: dto.name,
    brand: (dto as any).brand || undefined,
    thumbnail: pickPrimaryImage(dto),
    // 가격 정보는 Pricing API로 별도 조회 필요 (스펙에 없음)
    basePrice: undefined,
    membershipPrice: undefined,
    isMembershipOnly: !!(dto as any).isMembershipOnly,
    status: (dto as any).status, // status가 없으면 undefined, 컴포넌트에서 active로 간주
    tags: (dto as any).tags ?? [],
    stock: {},
    optionMeta: { isSingle },
    defaultSku, // ✅
  }
}

// ---------- 상세용 ----------
export const toProductDetail = (dto: ProductDetailDto): ProductDetail => {
  const card = toProductCard(dto)
  const allFromHtml = extractAllImgs(dto.descriptionHtml)

  // thumbnails는 메인 썸네일만 포함 (descriptionHtml 이미지 제외)
  const thumbnails = [card.thumbnail].filter(Boolean)
  // 옵션그룹 → UI 옵션
  const options = buildOptions(dto.optionGroups)

  // skuIndex 만들기: variantName을 파싱하여 옵션 조합 추출
  // ProductDetailDto의 variants는 optionValues가 없으므로 variantName을 파싱해야 함
  // variantName 형식: "빨강 × L" 또는 "색상:빨강|사이즈:L"
  const skuIndex: Record<string, string> = {}
  const groupById = new Map<string, { label: string; values: Map<string, OptionValueDto> }>()

  for (const g of dto.optionGroups ?? []) {
    const valueMap = new Map<string, OptionValueDto>()
    for (const v of g.values ?? []) {
      valueMap.set(v.id, v)
      // displayName으로도 매핑 (variantName 매칭용)
      valueMap.set(v.displayName.toLowerCase().trim(), v)
    }
    groupById.set(g.id, {
      label: g.displayName,
      values: valueMap,
    })
  }

  for (const v of dto.variants ?? []) {
    // variantName을 파싱하여 옵션 조합 추출
    // 형식: "빨강 × L" 또는 "색상:빨강|사이즈:L"
    const parts: Record<string, string> = {}

    // variantName을 파싱 (예: "빨강 × L" → ["빨강", "L"])
    const variantParts = v.variantName.split(/[×x]/).map(s => s.trim())

    // optionGroups의 값들과 매칭 시도
    let partIndex = 0
    for (const g of dto.optionGroups ?? []) {
      if (partIndex >= variantParts.length) break

      const variantPart = variantParts[partIndex].toLowerCase().trim()
      const matchedValue = Array.from(groupById.get(g.id)?.values.values() ?? []).find(
        val => val.displayName.toLowerCase().trim() === variantPart
      )

      if (matchedValue) {
        parts[g.displayName] = matchedValue.displayName
        partIndex++
      }
    }

    const key = makeOptionKey(parts)
    if (key) skuIndex[key] = v.id
  }

  // 할인율 계산은 가격 정보가 있을 때만 수행 (Pricing API로 조회 후)

  const result: ProductDetail = {
    ...card,
    thumbnails,
    originalPrice: card.basePrice,
    description: dto.description || undefined,
    descriptionHtml: sanitizeAndRewrite(dto.descriptionHtml),
    detailImages: allFromHtml, // descriptionHtml에서 추출한 이미지들을 detailImages에 설정
    // 가격 정보는 Pricing API로 별도 조회 필요 (스펙에 없음)
    memberPrices: undefined,
    options, // ✅ 옵션 UI용
    skuIndex, // ✅ 조합→변형ID 맵
    // skuStock: 서비스에서 withStock일 때 주입
    shipping: undefined,
    productInfo: undefined,
    categories: [],
    // 리뷰 정보는 별도 API로 조회 필요 (스펙에 없음)
    rating: 0,
    reviewCount: 0,
    qnaCount: 0,
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

