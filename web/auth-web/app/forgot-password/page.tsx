import { redirect } from "next/navigation"

import { sanitizeRedirectTo } from "@/lib/redirect"

type SearchParams = Promise<{ redirect_to?: string }>

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const params = await searchParams
  const redirectTo = sanitizeRedirectTo(params.redirect_to)

  redirect(
    `/find-account${
      redirectTo
        ? `?${new URLSearchParams({ redirect_to: redirectTo }).toString()}`
        : ""
    }`
  )
}
