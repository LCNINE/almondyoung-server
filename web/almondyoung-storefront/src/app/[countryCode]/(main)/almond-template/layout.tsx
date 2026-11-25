import { listAdminAlmondTemplates } from "@/lib/api/ugc/almond-templates"
import { ApiAuthError } from "@/lib/api/api-error"
import { headers } from "next/headers"
import { redirect } from "next/navigation"

export default async function AlmondTemplateLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ countryCode: string }>
}) {
  const { countryCode } = await params
  const head = await headers()
  const search = head.get("x-search") ?? ""
  if (!/[?&]mode=designer(&|$)/.test(search)) return children

  // 어드민의 편집 링크(?mode=designer&template=)로 왔는데 토큰이 없거나 만료됐으면 로그인 뒤 그 시안으로 돌아오게 한다
  const needsLogin = await listAdminAlmondTemplates().then(
    () => false,
    (error) => error instanceof ApiAuthError
  )
  if (needsLogin) {
    const back = `${head.get("x-pathname") ?? `/${countryCode}/almond-template`}${search}`
    redirect(`/${countryCode}/login?redirect_to=${encodeURIComponent(back)}`)
  }

  return children
}
