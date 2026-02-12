import { MypagePinSkeleton } from "@/components/skeletons/page-skeletons"
import { WithHeaderLayout } from "@components/layout"
import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { fetchMe } from "@lib/api/users/me"
import { Suspense } from "react"
import SecurityManager from "../(components)/sucurity-manager"
import ForgetPinForm from "domains/payment/components/forget-pin"

export default async function ForgetPinPage() {
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
        <Suspense fallback={<MypagePinSkeleton />}>
          <ForgetPinManager />
        </Suspense>
      </MypageLayout>
    </WithHeaderLayout>
  )
}

async function ForgetPinManager() {
  const currentUser = await fetchMe()

  // 핸드폰 인증이 안되어있으면 본인인증 모달 띄움
  if (!currentUser.profile?.phoneNumber) {
    return <SecurityManager />
  }

  return <ForgetPinForm />
}
