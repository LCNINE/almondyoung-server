import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { PageTitle } from "@/components/shared/page-title"
import { PasswordChange } from "@/domains/mypage/components/account/password-change"
import { api } from "@/lib/api/api"
import { WithHeaderLayout } from "@components/layout"
import { Metadata } from "next"
import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("mypage.menu")
  return { title: t("password") }
}

// URL 직접 접근 차단: 최근 본인확인(문자/이메일 코드) 통과 기록이 없으면 프로필로 돌려보낸다.
async function hasPassedIdentityCheck(): Promise<boolean> {
  try {
    const res = await api<{ verified: boolean }>(
      "users",
      "/email-verification/identity-status",
      {
        method: "GET",
        params: { purpose: "password_change" },
        next: { revalidate: 0 },
      }
    )
    return !!res.verified
  } catch {
    return false // 조회 실패 시 보수적으로 차단
  }
}

export default async function AccountPasswordPage({
  params,
}: {
  params: Promise<{ countryCode: string }>
}) {
  const { countryCode } = await params
  const t = await getTranslations("mypage.menu")

  if (!(await hasPassedIdentityCheck())) {
    redirect(`/${countryCode}/mypage/account/profile`)
  }
  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: t("password"),
      }}
    >
      <MypageLayout>
        <div className="bg-white px-3 py-4 md:min-h-screen md:px-6">
          <PageTitle>{t("password")}</PageTitle>
          <PasswordChange />
        </div>
      </MypageLayout>
    </WithHeaderLayout>
  )
}
