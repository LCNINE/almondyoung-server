import { WithHeaderLayout } from "@components/layout"
import MypageLayout from "@components/layout/mypage-layout"
import ProtectedRoute from "@components/protected-route"
import { getMyBusiness } from "@lib/api/users/business"
import { fetchMe } from "@lib/api/users/me"
import { getVerificationStatus } from "@lib/api/users/verification-status"
import { getBnplProfiles } from "@lib/api/wallet"
import { PaymentManagement } from "domains/payment/payment-management"

export default function PaymentPage() {
  return (
    <ProtectedRoute>
      <WithHeaderLayout
        config={{
          showDesktopHeader: true,
          showMobileHeader: false,
          showMobileSubBackHeader: true,
          mobileSubBackHeaderTitle: "결제수단 관리",
        }}
      >
        <MypageLayout>
          <PaymentContainer />
        </MypageLayout>
      </WithHeaderLayout>
    </ProtectedRoute>
  )
}

async function PaymentContainer() {
  const currentUser = await fetchMe()
  const verificationStatus = await getVerificationStatus() // step 별 진행 상태, 결제 수단 등록할 때 인증 정보 steps 별 진행 상태 확인용
  const businessInfo = await getMyBusiness()
  const bnplProfiles = await getBnplProfiles()

  return (
    <PaymentManagement
      currentUser={currentUser}
      verificationStatus={verificationStatus}
      businessInfo={businessInfo}
      bnplProfiles={bnplProfiles}
    />
  )
}
