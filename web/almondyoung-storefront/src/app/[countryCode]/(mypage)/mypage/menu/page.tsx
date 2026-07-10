import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { MENU_SECTIONS } from "@/domains/mypage/components/constants/mypage-constants"
import { MenuList } from "@/domains/mypage/components/mobile/menu-list"
import { WithHeaderLayout } from "@components/layout"
import { getTranslations } from "next-intl/server"

export default async function MypageMenuPage() {
  const t = await getTranslations("mypage.quickLink")

  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: t("allMenu"),
      }}
    >
      <MypageLayout>
        <MenuList sections={MENU_SECTIONS} />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
