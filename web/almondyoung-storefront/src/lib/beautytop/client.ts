"use client"

export type BeautyTopQuery = {
  resource: "shops" | "search" | "ranking" | "operating" | "price-comparison" | "activity" |
    "shop" | "position" | "briefing" | "changes" | "watch" | "leaders" | "prices" |
    "market" | "lifecycle" | "trends" | "revenue" | "franchise" | "options" | "analysis" | "map"
  page?: number
  page_size?: number
  after_id?: number
  [key: string]: string | number | undefined
}

export type BeautyTopResult<T> = {
  api_version: "1"
  resource: BeautyTopQuery["resource"]
  data: T
  pagination: null | {
    page: number | null; page_size: number; total: number; total_pages: number
    has_next: boolean; next_page: number | null; next_after_id?: number | null
    mode?: "page" | "cursor"
  }
}

type Proof = { access_token: string; api_base_url: string; expires_in: number }
let pending: Promise<Proof> | null = null

async function proof(): Promise<Proof> {
  // Share only concurrent requests. Every later query rechecks the login session;
  // tokens are never written to localStorage, URLs or a persistent cookie.
  if (!pending) {
    pending = (async () => {
      const response = await fetch("/api/beautytop/token", {
        method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
      })
      if (!response.ok) throw new Error(response.status === 401 ? "로그인이 필요합니다." : "뷰티탑 연결을 잠시 후 다시 시도해 주세요.")
      return response.json() as Promise<Proof>
    })().finally(() => { pending = null })
  }
  return pending
}

export async function queryBeautyTop<T>(query: BeautyTopQuery, signal?: AbortSignal): Promise<BeautyTopResult<T>> {
  const auth = await proof()
  const base = new URL(auth.api_base_url)
  if (base.protocol !== "https:" || base.username || base.password) throw new Error("뷰티탑 연결 주소를 확인해 주세요.")
  const url = new URL("/v1/query", base)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${auth.access_token}` },
    credentials: "omit", cache: "no-store", redirect: "error", signal,
  })
  if (!response.ok) throw new Error(response.status === 401 ? "로그인이 필요합니다." : response.status === 429 ? "조회가 많습니다. 잠시 후 다시 시도해 주세요." : "자료를 불러오지 못했습니다.")
  return response.json() as Promise<BeautyTopResult<T>>
}
