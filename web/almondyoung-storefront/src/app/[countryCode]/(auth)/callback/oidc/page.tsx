import { oidcCallback } from "@/lib/api/medusa/sso"
import { redirect } from "next/navigation"

type Props = {
  params: Promise<{ countryCode: string }>
  searchParams: Promise<{ code?: string; state?: string; error?: string; error_description?: string; redirect_to?: string }>
}

export default async function OidcCallbackPage({ params, searchParams }: Props) {
  const { countryCode } = await params
  const sp = await searchParams

  if (sp.error) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-xl font-semibold">로그인에 실패했습니다</h1>
        <p className="mt-2 text-sm text-muted-foreground">{sp.error_description ?? sp.error}</p>
        <a href={`/${countryCode}/account/login`} className="mt-4 inline-block underline">
          다시 시도하기
        </a>
      </div>
    )
  }

  if (!sp.code || !sp.state) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-xl font-semibold">잘못된 콜백</h1>
        <p className="mt-2 text-sm text-muted-foreground">code 또는 state 파라미터가 없습니다.</p>
      </div>
    )
  }

  const result = await oidcCallback({
    code: sp.code,
    state: sp.state,
    countryCode,
    redirectTo: sp.redirect_to,
  })

  if (!result.success) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-xl font-semibold">로그인에 실패했습니다</h1>
        <p className="mt-2 text-sm text-muted-foreground break-all">{result.error}</p>
        <a href={`/${countryCode}/account/login`} className="mt-4 inline-block underline">
          다시 시도하기
        </a>
      </div>
    )
  }

  redirect(result.redirectTo)
}
