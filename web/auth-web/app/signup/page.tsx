import { notFound } from "next/navigation"
import { AuthShell } from "@/components/auth-shell"
import { SignUpForm } from "@/components/signup-form"
import { sanitizeRedirectTo } from "@/lib/redirect"

type SearchParams = Promise<{ redirect_to?: string }>

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  if (process.env.APP_STAGE === "demo") notFound()
  const params = await searchParams
  const redirectTo = sanitizeRedirectTo(params.redirect_to) ?? ""
  return (
    <AuthShell className="sm:max-w-[640px]">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">회원가입</h1>
      </header>
      <SignUpForm redirectTo={redirectTo} />
    </AuthShell>
  )
}
