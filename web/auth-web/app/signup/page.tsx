import { notFound } from "next/navigation"
import { AuthShell } from "@/components/auth-shell"
import { SignUpForm } from "@/components/signup-form"
import { requireDefaultSite, sanitizeRedirectTo } from "@/lib/site/site"

type SearchParams = Promise<{ redirect_to?: string }>

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  // 가입·찾기는 기본 주소에만 — 테넌트 도메인엔 없다(인증 문자가 아몬드영 이름으로 나간다).
  await requireDefaultSite()
  if (process.env.APP_STAGE === "demo") notFound()
  const params = await searchParams
  const redirectTo = (await sanitizeRedirectTo(params.redirect_to)) ?? ""
  return (
    <AuthShell className="sm:max-w-[640px]">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">회원가입</h1>
      </header>
      <SignUpForm redirectTo={redirectTo} />
    </AuthShell>
  )
}
