import { FindIdForm } from "@/components/find-id-form"
import { sanitizeRedirectTo } from "@/lib/redirect"

type SearchParams = Promise<{ redirect_to?: string }>

export default async function FindIdPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const params = await searchParams
  const redirectTo = sanitizeRedirectTo(params.redirect_to) ?? ""

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">아이디 찾기</h1>
        <p className="text-sm text-muted-foreground">
          휴대폰 인증 후 가입한 아이디를 확인할 수 있습니다.
        </p>
      </header>
      <FindIdForm redirectTo={redirectTo} />
    </main>
  )
}
