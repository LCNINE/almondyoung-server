import {
  PimCategory,
  PimListResponse,
  PimProductDetail,
} from "@lib/types/dto/pim"
import { PIM_BASE_URL } from "../api.config"

type CategoriesResp = { categories: PimCategory[]; totalCount?: number }

//카테고리
export async function fetchCategories(): Promise<PimCategory[]> {
  console.log("🌐 [fetchCategories] API 호출 시작")

  const res = await fetch(`${PIM_BASE_URL}/categories`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "ngrok-skip-browser-warning": "true",
    },
    mode: "cors",
    cache: "no-store", // 캐시는 서비스 레이어에서 담당
  })

  if (!res.ok) {
    console.error(
      "❌ [fetchCategories] API 요청 실패:",
      res.status,
      res.statusText
    )
    throw new Error(`API 요청 실패: ${res.status} ${res.statusText}`)
  }

  const json = (await res.json()) as CategoriesResp
  const data = json?.categories ?? []

  console.log("🌐 [fetchCategories] API 응답:", data)
  return data
}

// fetchCategoriesISR 별칭 (기존 코드 호환성을 위해)
export const fetchCategoriesISR = fetchCategories

/**
 * PIM 상품 상세 정보 조회 (순수 API 호출)
 */
//카드형
export async function getAllProductList(
  params?: {
    page?: number
    limit?: number
    status?: string
    brand?: string
    search?: string // ✅ 기존
    query?: string // ✅ 서비스 단의 'query'도 허용
    categoryId?: string
    sort?: string
    stock?: string[]
    tags?: string[]
  },
  signal?: AbortSignal
): Promise<PimListResponse<PimProductDetail>> {
  const searchParams = new URLSearchParams()

  if (params?.page) searchParams.set("page", String(params.page))
  if (params?.limit) searchParams.set("limit", String(params.limit))
  if (params?.status) searchParams.set("status", params.status)
  if (params?.brand) searchParams.set("brand", params.brand)
  // ✅ query 또는 search 중 하나만 넘어와도 'search'로 매핑
  const q = params?.search ?? params?.query
  if (q) searchParams.set("search", q)
  if (params?.categoryId) searchParams.set("categoryId", params.categoryId)
  if (params?.sort) searchParams.set("sort", params.sort)
  if (params?.tags?.length) searchParams.set("tags", params.tags.join(","))
  if (params?.stock?.length) searchParams.set("stock", params.stock.join(","))

  const url = `${PIM_BASE_URL}/masters?${searchParams.toString()}`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10000)

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "ngrok-skip-browser-warning": "true",
      },
      mode: "cors",
      cache: "no-store",
      signal: signal || controller.signal,
    })
    clearTimeout(timeoutId)
    console.log("요청url", url)

    if (!res.ok) {
      if (res.status >= 500)
        throw new Error(
          "서버에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해주세요."
        )
      if (res.status >= 400)
        throw new Error("요청을 처리할 수 없습니다. 입력 정보를 확인해주세요.")
      throw new Error(`요청 실패: ${res.status} ${res.statusText}`)
    }

    const json = await res.json()
    console.log("최초응답값", json)

    // 응답 구조 처리: json.data가 배열인지 객체인지 확인
    let items = []
    if (Array.isArray(json?.data)) {
      items = json.data
    } else if (json?.data?.items) {
      items = json.data.items
    } else {
      items = json?.items ?? json?.products ?? json?.masters ?? []
    }

    const total =
      json?.total ?? json?.data?.total ?? json?.count ?? items.length
    const page = json?.page ?? Number(searchParams.get("page") ?? 1)
    const limit = json?.limit ?? Number(searchParams.get("limit") ?? 10)

    return { items, total, page, limit }
  } catch (err) {
    clearTimeout(timeoutId)
    throw err
  }
}

//상세정보포함
export async function getPimProductDetail(
  id: string
): Promise<PimProductDetail> {
  const url = `${PIM_BASE_URL}/masters/${id}`
  console.log("🌐 [getPimProductDetail] 요청 URL:", url)

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "ngrok-skip-browser-warning": "true",
    },
    mode: "cors",
    cache: "no-store",
  })

  if (!res.ok) {
    if (res.status >= 500)
      throw new Error(
        "서버에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해주세요."
      )
    if (res.status >= 400)
      throw new Error("요청을 처리할 수 없습니다. 입력 정보를 확인해주세요.")
    throw new Error(`요청 실패: ${res.status} ${res.statusText}`)
  }

  // 응답이 JSON인지 확인
  const contentType = res.headers.get("content-type")
  const text = await res.text()
  console.log("text", text)
  if (!contentType?.includes("application/json")) {
    console.error(
      "❌ [getPimProductDetail] JSON이 아닌 응답:",
      text.substring(0, 200)
    )
    throw new Error(
      `서버가 HTML 응답을 반환했습니다. API 엔드포인트를 확인해주세요.`
    )
  }

  // 텍스트를 다시 JSON으로 파싱
  const json = JSON.parse(text)
  console.log("🌐 [getPimProductDetail] 응답 데이터:", json)
  // console.log('✅ [getPimProductDetail] 응답 데이터:', json)
  return json as PimProductDetail
}

// ✅ 새로 추가: 카테고리별 상품 조회 (전용 엔드포인트 사용)
export async function getPimCategoryProducts(
  categoryId: string,
  params?: {
    page?: number
    limit?: number
    sort?: string
    brand?: string
    search?: string
    tags?: string[]
    stock?: string[]
  }
): Promise<PimListResponse<PimProductDetail>> {
  console.log("🌐 [getPimCategoryProducts] API 호출 시작:", {
    categoryId,
    params,
  })

  if (!PIM_BASE_URL) throw new Error("PIM API URL이 설정되지 않았습니다.")
  if (!categoryId) throw new Error("카테고리 ID가 제공되지 않았습니다.")

  const sp = new URLSearchParams()
  if (params?.page) sp.set("page", String(params.page))
  if (params?.limit) sp.set("limit", String(params.limit))
  if (params?.sort) sp.set("sort", params.sort)
  if (params?.brand) sp.set("brand", params.brand)
  if (params?.search) sp.set("search", params.search)
  if (params?.tags?.length) sp.set("tags", params.tags.join(","))
  if (params?.stock?.length) sp.set("stock", params.stock.join(","))

  const url = `${PIM_BASE_URL}/masters?${categoryId}`
  console.log("🌐 [getPimCategoryProducts] 요청 URL:", url)
  // 필요 시 /categories/:id/masters 형태를 쓰는 백엔드라면 위 URL만 바꾸면 됨.

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 3500)

  try {
    console.log("📡 [getPimCategoryProducts] fetch 요청 시작")
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "ngrok-skip-browser-warning": "true",
      },
      mode: "cors",
      cache: "no-store",
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    // console.log('📡 [getPimCategoryProducts] 응답 상태:', {
    //   status: res.status,
    //   ok: res.ok,
    //   statusText: res.statusText
    // })

    if (!res.ok) {
      if (res.status >= 500)
        throw new Error(
          "서버에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해주세요."
        )
      if (res.status >= 400)
        throw new Error("요청을 처리할 수 없습니다. 입력 정보를 확인해주세요.")
      throw new Error(`요청 실패: ${res.status} ${res.statusText}`)
    }

    const json = await res.json()
    console.log("📄 [getPimCategoryProducts] 응답 데이터:", json)

    // ✅ 다양한 응답 포맷에 대한 정규화
    let items = []
    if (Array.isArray(json?.data)) {
      items = json.data
    } else if (json?.data?.items) {
      items = json.data.items
    } else {
      items = json?.items ?? json?.products ?? json?.masters ?? []
    }

    const total =
      json?.total ?? json?.data?.total ?? json?.count ?? items.length
    const page = json?.page ?? Number(sp.get("page") ?? 1)
    const limit = json?.limit ?? Number(sp.get("limit") ?? 10)

    console.log("✅ [getPimCategoryProducts] 정규화 완료:", {
      itemsCount: items.length,
      total,
      page,
      limit,
    })

    return { items, total, page, limit }
  } catch (err) {
    console.error("❌ [getPimCategoryProducts] 에러 발생:", err)
    clearTimeout(timeoutId)
    throw err
  }
}
