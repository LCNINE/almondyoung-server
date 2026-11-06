import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { MyAlmondDesigns } from "@/domains/almond-template/components/my-designs"
import { listAdminAlmondTemplates } from "@/lib/api/ugc/almond-templates"
import { WithHeaderLayout } from "@components/layout"
import { getTranslations } from "next-intl/server"
import { redirect } from "next/navigation"

export default async function MyAlmondTemplatesPage({
  params,
}: {
  params: Promise<{ countryCode: string }>
}) {
  const { countryCode } = await params
  const canDesign = await listAdminAlmondTemplates().then(
    () => true,
    () => false
  )
  if (!canDesign) redirect(`/${countryCode}?comingSoon=almond-template`)

  const t = await getTranslations("mypage.almondTemplates")
  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: t("title"),
      }}
    >
      <MypageLayout>
        <div className="px-4 py-6 md:px-0 md:py-0">
          <h1 className="text-foreground text-2xl font-bold">{t("title")}</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            {t("description")} {t("limit")}
          </p>
          <MyAlmondDesigns />
        </div>
      </MypageLayout>
    </WithHeaderLayout>
  )
}
