import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { MyAlmondDesigns } from "@/domains/almond-template/components/my-designs"
import { WithHeaderLayout } from "@components/layout"
import { getTranslations } from "next-intl/server"

export default async function MyAlmondTemplatesPage() {
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
