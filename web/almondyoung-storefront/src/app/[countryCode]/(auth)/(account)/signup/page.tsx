import { MobileBackHeader } from "@components/layout/components/header"
import { fetchCurrentUser } from "@lib/api/users"
import SignupTemplate from "domains/auth/templates/signup-template"
import { redirect } from "next/navigation"

export default async function SignupPage({
  params,
}: {
  params: Promise<{ countryCode: string }>
}) {
  const { countryCode } = await params
  const currentUser = await fetchCurrentUser().catch(() => null)

  if (currentUser) {
    redirect(`/${countryCode}/`)
  }

  return (
    <>
      <MobileBackHeader title="회원가입" />
      <SignupTemplate />
    </>
  )
}
