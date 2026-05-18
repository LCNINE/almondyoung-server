import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { PageTitle } from "@/components/shared/page-title"
import { WithHeaderLayout } from "@components/layout"
import { Metadata } from "next"
import { getTranslations } from "next-intl/server"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("mypage.page")
  return { title: t("subscribeManage") }
}

export default async function SubscribeManagePage() {
  const t = await getTranslations("mypage.page")
  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: t("subscribeManage"),
      }}
    >
      <MypageLayout>
        <div className="pb-4">
          <PageTitle>{t("subscribeManage")}</PageTitle>
          <div className="bg-white px-5 py-20">
            <div className="flex flex-col items-center justify-center gap-4 text-center">
              <div className="text-[48px]">📦</div>
            </div>
          </div>
        </div>
      </MypageLayout>
    </WithHeaderLayout>
  )
}
