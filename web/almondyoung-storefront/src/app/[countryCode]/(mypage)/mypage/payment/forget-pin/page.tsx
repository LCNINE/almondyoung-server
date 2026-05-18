import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { WithHeaderLayout } from "@components/layout"
import { fetchMe } from "@lib/api/users/me"
import { getTranslations } from "next-intl/server"
import ForgetPinForm from "domains/payment/components/forget-pin"
import SecurityManager from "../(components)/sucurity-manager"

export default async function ForgetPinPage() {
  const t = await getTranslations("mypage.page")
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
        <ForgetPinManager />
      </MypageLayout>
    </WithHeaderLayout>
  )
}

async function ForgetPinManager() {
  const currentUser = await fetchMe()

  if (!currentUser.profile?.phoneNumber) {
    return <SecurityManager redirectTo="" />
  }

  return <ForgetPinForm />
}
