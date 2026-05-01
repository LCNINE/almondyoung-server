import { WithHeaderLayout } from "@components/layout"
import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { PageTitle } from "@/components/shared/page-title"
import { PasswordChange } from "@/domains/mypage/components/account/password-change"
import { Metadata } from "next"

export const metadata: Metadata = {
  title: "비밀번호 변경",
  description: "비밀번호를 변경하세요",
}

export default function AccountPasswordPage() {
  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: "비밀번호 변경",
      }}
    >
      <MypageLayout>
        <div className="bg-white px-3 py-4 md:min-h-screen md:px-6">
          <PageTitle>비밀번호 변경</PageTitle>
          <PasswordChange />
        </div>
      </MypageLayout>
    </WithHeaderLayout>
  )
}
