import { notFound, redirect } from "next/navigation"

import { AuthShell } from "@/components/auth-shell"
import { ChangePasswordForm } from "@/components/change-password-form"
import { getActiveSessionUser } from "@/lib/session"
import { getSite, sanitizeRedirectTo } from "@/lib/site/site"

type SearchParams = Promise<{ redirect_to?: string }>

/**
 * 테넌트 도메인의 첫 로그인 비밀번호 변경. 기본 주소는 이 화면을 쓰지 않는다 — admin-web 이 자기 화면에서 바꾸게 한다.
 */
export default async function ChangePasswordPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  if ((await getSite()).kind !== "tenant") notFound()
  const params = await searchParams
  const redirectTo = (await sanitizeRedirectTo(params.redirect_to)) ?? ""
  const qs = redirectTo
    ? `?${new URLSearchParams({ redirect_to: redirectTo })}`
    : ""

  const user = await getActiveSessionUser()
  if (!user) redirect(`/signin${qs}`)
  // 이미 바꿨으면(뒤로 가기·새로고침) 원래 가던 곳으로.
  if (!user.mustChangePassword) redirect(redirectTo || "/")

  return (
    <AuthShell>
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl leading-8 font-bold text-foreground">
          새 비밀번호 정하기
        </h1>
        <p className="text-sm leading-5 text-muted-foreground">
          처음 받은 비밀번호는 바꿔야 계속할 수 있어요.
        </p>
      </header>
      <ChangePasswordForm redirectTo={redirectTo} />
    </AuthShell>
  )
}
