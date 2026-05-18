import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { WithHeaderLayout } from "@components/layout"
import { getTranslations } from "next-intl/server"
import SecurityManager from "../(components)/sucurity-manager"

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_to?: string }>
}) {
  const t = await getTranslations("mypage.page")
  const params = await searchParams
  const redirectTo = params.redirect_to ?? ""

  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: t("passwordSettings"),
      }}
    >
      <MypageLayout>
        <SecurityManager redirectTo={redirectTo} />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
