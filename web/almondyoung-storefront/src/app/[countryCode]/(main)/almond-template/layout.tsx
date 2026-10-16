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
  const canDesign = await listAdminAlmondTemplates().then(
    () => true as const,
    (error) => (error instanceof ApiAuthError ? ("login" as const) : false)
  )
  // 토큰이 없거나 만료돼 권한을 확인할 수 없으면 "준비 중"이 아니라 로그인으로 보낸다.
  // 어드민의 편집 링크(?mode=designer&template=)를 그대로 돌아올 주소로 넘겨야 로그인 뒤 그 시안이 열린다
  // 손님이 목록에 들어온 경우는 지금처럼 "준비 중"으로 돌려보낸다
  const head = await headers()
  const search = head.get("x-search") ?? ""
  if (canDesign === "login" && /[?&]mode=designer(&|$)/.test(search)) {
    const back = `${head.get("x-pathname") ?? `/${countryCode}/almond-template`}${search}`
    redirect(`/${countryCode}/login?redirect_to=${encodeURIComponent(back)}`)
  }
  if (canDesign !== true) redirect(`/${countryCode}?comingSoon=almond-template`)
  return children
}
