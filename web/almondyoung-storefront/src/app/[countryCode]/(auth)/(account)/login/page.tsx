import { MobileBackHeader } from "@components/layout/components/header"
import { fetchMe } from "@lib/api/users/me"
import LoginTemplate from "domains/auth/templates/login-template"
import { redirect } from "next/navigation"

export default async function LoginPage({
  params,
}: {
  params: Promise<{ countryCode: string }>
}) {
  const { countryCode } = await params
  const currentUser = await fetchMe().catch(() => null)

  if (currentUser) {
    // redirect(`/${countryCode}/`)
  }

  return (
    <>
      <MobileBackHeader title="로그인" />
      <LoginTemplate />
    </>
  )
}
