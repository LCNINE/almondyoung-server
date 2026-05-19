import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { PageTitle } from "@/components/shared/page-title"
import { WithdrawForm } from "@/domains/mypage/components/account/withdraw-form"
import { WithHeaderLayout } from "@components/layout"
import { Metadata } from "next"
import { getTranslations } from "next-intl/server"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("mypage.account.withdraw")
  return { title: t("pageTitle") }
}

export default async function AccountWithdrawPage({
  params,
}: {
  params: Promise<{ countryCode: string }>
}) {
  const t = await getTranslations("mypage.account.withdraw")
  const { countryCode } = await params

  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: t("pageTitle"),
      }}
    >
      <MypageLayout>
        <div className="bg-white px-3 py-4 md:min-h-screen md:px-6">
          <PageTitle>{t("pageTitle")}</PageTitle>
          <WithdrawForm countryCode={countryCode} />
        </div>
      </MypageLayout>
    </WithHeaderLayout>
  )
}
