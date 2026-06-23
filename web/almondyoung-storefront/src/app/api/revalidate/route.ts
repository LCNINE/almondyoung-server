import { listRegions } from "@lib/api/medusa/regions"
import { revalidatePath, revalidateTag } from "next/cache"
import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

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
 * 주의: 캐시 태그가 `${tag}-${_medusa_cache_id}` 형태로 **사용자별** 이라
 * (middleware 가 방문자마다 randomUUID 발급), 백엔드에서 `revalidateTag` 로
 * 전역 무효화가 불가능하다. 그래서 사용자와 무관한 `revalidatePath` 로
 * **바뀐 상품의 상세 경로만** 정밀 무효화한다 (`/{locale}/products/{handle}`).
 */
export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-revalidate-secret")
  const expected = process.env.REVALIDATE_SECRET

  if (!expected || secret !== expected) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    )
  }

  let body: { handle?: string; paths?: string[] } = {}
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

  // 호출자가 명시한 추가 경로가 있으면 함께 무효화.
  for (const p of body.paths ?? []) {
    revalidatePath(p)
    revalidated.push(p)
  }

  return NextResponse.json({
    ok: true,
    handle: body.handle ?? null,
    revalidated,
  })
}
