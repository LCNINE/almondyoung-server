import { redirect } from "next/navigation"

import { requireDefaultSite, sanitizeRedirectTo } from "@/lib/site/site"

type SearchParams = Promise<{ redirect_to?: string }>

export default async function FindIdPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  // 가입·찾기는 기본 주소에만 — 테넌트 도메인엔 없다(인증 문자가 아몬드영 이름으로 나간다).
  await requireDefaultSite()
  const params = await searchParams
  const redirectTo = await sanitizeRedirectTo(params.redirect_to)

  redirect(
    `/find-account${
      redirectTo
        ? `?${new URLSearchParams({ redirect_to: redirectTo }).toString()}`
        : ""
    }`
  )
}
