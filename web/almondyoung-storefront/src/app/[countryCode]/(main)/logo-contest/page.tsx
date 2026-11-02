import { permanentRedirect } from "next/navigation"

export default async function RetiredContestPage({
  params,
}: {
  params: Promise<{ countryCode: string }>
}) {
  const { countryCode } = await params

  permanentRedirect(`/${countryCode}`)
}
