import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { WithHeaderLayout } from "@components/layout"
import { Construction } from "lucide-react"
import { getTranslations } from "next-intl/server"

export default async function MembershipSubscribePage() {
  const t = await getTranslations("mypage.page")
  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: t("membershipJoin"),
      }}
    >
      <MypageLayout>
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 p-8">
          <Construction className="h-24 w-24 text-amber-500" />
          <div className="text-center">
            <h1 className="text-3xl font-bold text-gray-800">
              {t("membershipJoin")}
            </h1>
          </div>
        </div>
      </MypageLayout>
    </WithHeaderLayout>
  )
}
