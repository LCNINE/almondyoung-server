import "server-only"

import { headers } from "next/headers"
import { notFound } from "next/navigation"
import { cache } from "react"

import { env } from "../env"
import { lookupTenantSite } from "../user-service"
import {
  allowedRedirect,
  cachedLookup,
  codeRedirectAllowed,
  resolveSite,
  type Site,
} from "./site-rules"

const lookup = cachedLookup(lookupTenantSite, { ttlMs: 60_000 })

/**
 * 이 요청이 어느 화면인가 — 들어온 주소로 정한다(요청 하나에 한 번). 테넌트 도메인 배포는 CloudFront 요청 함수가
 * `x-forwarded-host` 에 원래 Host 를 싣는다.
 */
export const getSite = cache(async (): Promise<Site> => {
  const h = await headers()
  const forwarded = h.get("x-forwarded-host")?.split(",")[0]
  return resolveSite(forwarded ?? h.get("host"), env.selfOrigin, lookup)
})

/** 이 화면에서 나가도 되는 주소면 정규화한 URL, 아니면 null(규칙은 `allowedRedirect`). */
export async function sanitizeRedirectTo(
  raw: string | null | undefined
): Promise<string | null> {
  return allowedRedirect(raw, await getSite(), env.allowedRedirectHosts)
}

/** 인가 코드를 이 redirect_uri 로 보내도 되는가(규칙은 `codeRedirectAllowed`). */
export async function codeRedirectAllowedHere(
  redirectUri: string
): Promise<boolean> {
  return codeRedirectAllowed(redirectUri, await getSite(), lookup)
}

/** 가입·찾기·약관처럼 기본 주소에만 있는 화면. 테넌트 도메인·중립 오류 화면에서는 404. */
export async function requireDefaultSite(): Promise<void> {
  if ((await getSite()).kind !== "default") notFound()
}
