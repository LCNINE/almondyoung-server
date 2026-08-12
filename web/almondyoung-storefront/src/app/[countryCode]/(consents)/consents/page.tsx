import { getConsents } from "@lib/api/users/consents"
import { fetchMe } from "@lib/api/users/me"
import { ConsentsTemplate } from "domains/consents/consents-template"
import { redirect } from "next/navigation"
import type { Metadata } from "next"
import { NOINDEX } from "@lib/seo"

export const metadata: Metadata = { robots: NOINDEX }

export default async function ConsentsPage({
  params,
}: {
  params: Promise<{ countryCode: string; redirectTo: string }>
}) {
  const { countryCode, redirectTo } = await params

  const currentUser = await fetchMe().catch(() => null)
  if (currentUser) {
    const consents = await getConsents().catch(() => null)

    if (consents) {
      return redirect(redirectTo ?? `/${countryCode}/`)
    }
  }

  return <ConsentsTemplate redirectTo={redirectTo} />
}
