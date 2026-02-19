import { WithHeaderLayout } from "@components/layout"
import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import SecurityManager from "../(components)/sucurity-manager"

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_to?: string }>
}) {
  const params = await searchParams
  const redirectTo = params.redirect_to ?? ""

  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: "비밀번호 설정",
      }}
    >
      <MypageLayout>
        <SecurityManager redirectTo={redirectTo} />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
