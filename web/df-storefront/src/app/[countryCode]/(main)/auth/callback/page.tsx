import { completeSsoCallback } from "@lib/data/customer"
import { redirect } from "next/navigation"

type Props = {
  params: Promise<{ countryCode: string }>
  searchParams: Promise<{ state?: string; redirect_to?: string; error?: string }>
}

export const dynamic = "force-dynamic"

export default async function SsoCallbackPage({ params, searchParams }: Props) {
  const { countryCode } = await params
  const { state, redirect_to = "/", error } = await searchParams

  if (error) {
    redirect(`/${countryCode}/account?sso_error=${encodeURIComponent(error)}`)
  }

  if (!state) {
    redirect(`/${countryCode}/account?sso_error=missing_state`)
  }

  try {
    await completeSsoCallback(state)
  } catch (e: any) {
    const msg = encodeURIComponent(e?.message ?? "sso_callback_failed")
    redirect(`/${countryCode}/account?sso_error=${msg}`)
  }

  redirect(`/${countryCode}${redirect_to.startsWith("/") ? redirect_to : `/${redirect_to}`}`)
}
