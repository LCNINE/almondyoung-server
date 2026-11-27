"use client"

import { useParams, usePathname } from "next/navigation"

const DEFAULT_REGION = process.env.NEXT_PUBLIC_DEFAULT_REGION || "kr"

export const resolveCountryCode = (
  paramCountryCode: string | string[] | undefined,
  pathname: string | null
): string => {
  if (typeof paramCountryCode === "string" && paramCountryCode) {
    return paramCountryCode
  }

  const firstSegment = pathname?.split("/")[1] ?? ""

  return /^[a-z]{2}$/.test(firstSegment) ? firstSegment : DEFAULT_REGION
}

// 없는 주소의 404 는 [countryCode] 레이아웃 밖(루트)에서 그려져 경로 파라미터가 비어 있다
export const useCountryCode = (): string => {
  const params = useParams<{ countryCode?: string }>()
  const pathname = usePathname()

  return resolveCountryCode(params?.countryCode, pathname)
}
