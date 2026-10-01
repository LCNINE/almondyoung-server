import { listAdminAlmondTemplates } from "@/lib/api/ugc/almond-templates"
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
    () => true,
    () => false
  )
  if (!canDesign) redirect(`/${countryCode}?comingSoon=almond-template`)
  return children
}
