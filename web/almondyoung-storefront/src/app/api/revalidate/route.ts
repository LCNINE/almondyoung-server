import { listRegions } from "@lib/api/medusa/regions"
import { revalidatePath, revalidateTag } from "next/cache"
import { NextRequest, NextResponse } from "next/server"
import { createWebLogger } from "@packages/web-observability"
import { PRODUCT_LIST_TAG } from "@lib/data/cache-tags"
import { CATEGORY_TREE_TAG } from "@lib/data/catalog-cache"

export const dynamic = "force-dynamic"

const logger = createWebLogger({
  component: "storefront.revalidate",
  route: "/api/revalidate",
})

/**
 * Medusa region 에 등록된 country code(iso_2) 목록을 동적으로 가져온다.
 * region 구성이 바뀌어도 코드 수정 없이 따라가도록 하드코딩하지 않는다.
 * 조회 실패 시 기본 region 으로 폴백.
 */
async function getCountryCodes(): Promise<string[]> {
  try {
    const regions = await listRegions()
    const codes = new Set<string>()
    for (const region of regions ?? []) {
      for (const country of region.countries ?? []) {
        if (country?.iso_2) codes.add(country.iso_2)
      }
    }
    if (codes.size > 0) return Array.from(codes)
  } catch {
    // 폴백으로 진행
  }
  return [process.env.NEXT_PUBLIC_DEFAULT_REGION || "kr"]
}

/**
 * On-demand 캐시 무효화 엔드포인트.
 *
 * 상품/재고가 백엔드(Core → channel-adapter → Medusa)에서 바뀌면 channel-adapter 가
 * 이 라우트를 호출해 해당 상품의 스토어프론트 페이지 캐시를 즉시 무효화한다.
 *
 * 카탈로그 조회는 방문자별로 태그를 쪼개지 않는다 — 응답은 (세그먼트, region, 쿼리)의
 * 함수이고 그 값들은 캐시 키에 들어간다(`lib/data/catalog-cache.ts`). 대신 모든 조회가
 * 방문자 무관 태그(`PRODUCT_LIST_TAG`)를 함께 달아, 여기서 그 태그를 쳐서 회원/비회원 캐시를
 * 한 번에 걷어낸다. 상세 페이지는 `product-{handle}` 태그와 경로로 추가 무효화한다.
 */
export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-revalidate-secret")
  const expected = process.env.REVALIDATE_SECRET

  if (!expected || secret !== expected) {
    logger.warn("storefront.revalidate.unauthorized", {
      attributes: {
        has_expected_secret: Boolean(expected),
        has_provided_secret: Boolean(secret),
      },
    })
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    )
  }

  let body: { handle?: string; paths?: string[]; tags?: string[] } = {}
  try {
    body = await request.json()
  } catch {
    // 빈 바디 허용
  }

  const revalidated: string[] = []

  // 바뀐 상품의 상세 페이지를 region(locale) 별로 정밀 무효화.
  if (body.handle) {
    revalidateTag(`product-${body.handle}`)
    revalidated.push(`tag:product-${body.handle}`)

    revalidateTag(PRODUCT_LIST_TAG)
    revalidated.push(`tag:${PRODUCT_LIST_TAG}`)

    const countryCodes = await getCountryCodes()
    for (const cc of countryCodes) {
      const path = `/${cc}/products/${body.handle}`
      revalidatePath(path)
      revalidated.push(path)
    }
  }

  // 카테고리 목록 페이지는 상품의 정확한 카테고리(중첩 handle 경로)를 호출 측에서 알기 어렵고,
  // 재고 변경 이벤트엔 카테고리 정보가 없으므로, 카테고리 라우트의 모든 인스턴스를 패턴 무효화한다.
  // (카테고리 페이지 수는 적어 비용이 작다. route group `(main)` 은 패턴에 포함되지 않는다)
  revalidatePath("/[countryCode]/category/[...segments]", "page")
  revalidated.push("/[countryCode]/category/[...segments]")

  // 카테고리 트리를 호출마다 걷어낸다. 카테고리 편집 경로(revalidateCategory)는 썸네일
  // 태그만 지목하고 트리 태그는 안 보내므로, 이 무조건 무효화가 카테고리 편집을 트리에
  // 반영하는 유일한 경로다. 상품 변경 호출에도 같이 걷히는 비용은 감수한다 — 트리 조회는
  // 한 번의 fetch 라 재적재가 싸다.
  revalidateTag(CATEGORY_TREE_TAG)
  revalidated.push(`tag:${CATEGORY_TREE_TAG}`)

  // 호출자가 명시한 태그(예: `category-thumbnail-{medusaCategoryId}`)를 무효화.
  // 사용자별 접미사가 붙지 않는 태그만 유효하다 — Medusa SDK 캐시 태그엔 쓸 수 없다.
  for (const tag of body.tags ?? []) {
    revalidateTag(tag)
    revalidated.push(`tag:${tag}`)
  }

  // 호출자가 명시한 추가 경로가 있으면 함께 무효화.
  for (const p of body.paths ?? []) {
    revalidatePath(p)
    revalidated.push(p)
  }

  logger.info("storefront.revalidate.completed", {
    attributes: {
      handle: body.handle ?? null,
      paths_count: body.paths?.length ?? 0,
      revalidated_count: revalidated.length,
    },
  })

  return NextResponse.json({
    ok: true,
    handle: body.handle ?? null,
    revalidated,
  })
}
