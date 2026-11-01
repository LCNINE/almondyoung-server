import { notFound } from "next/navigation"
import { AuthShell } from "@/components/auth-shell"
import { FindAccountForm } from "@/components/find-account-form"
import { requireDefaultSite, sanitizeRedirectTo } from "@/lib/site/site"

type SearchParams = Promise<{ redirect_to?: string }>

export default async function FindAccountPage({
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
    <AuthShell>
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl leading-8 font-bold text-foreground">
          아이디·비밀번호 찾기
        </h1>
        <p className="text-sm leading-5 text-muted-foreground">
          휴대폰 인증 후 아이디를 확인하고, 비밀번호도 새로 설정할 수 있습니다.
        </p>
      </header>
      <FindAccountForm redirectTo={redirectTo} />
    </AuthShell>
  )
}
