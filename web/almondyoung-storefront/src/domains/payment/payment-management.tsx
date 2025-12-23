import { PageTitle } from "@components/common/page-title"
import { getMyBusiness } from "@lib/api/users/business"
import { fetchMe } from "@lib/api/users/me"
import { getVerificationStatus } from "@lib/api/users/verification-status"
import { getBnplProfiles, getPointBalance } from "@lib/api/wallet"
import AccountSection from "./components/account-section"
import BankAccountWizard from "./components/bank-account-wizard/bank-account-wizard"
import BnplSection from "./components/bnpl-section"
import BnplVerificationWizard from "./components/bnpl-verification-wizard/bnpl-verification-wizard"
import PaymentMenuList from "./components/payment-menu-list"
import PointSection from "./components/point-section"
import PendingPointsSection from "./components/sections/pending-points-section"

export default async function PaymentManager() {
  const currentUser = await fetchMe()
  const verificationStatus = await getVerificationStatus() // step 별 진행 상태, 결제 수단 등록할 때 인증 정보 steps 별 진행 상태 확인용
  const businessInfo = await getMyBusiness() // 사업자 정보 조회
  const bnplProfiles = await getBnplProfiles() // 나중결제 계좌 조회

  const { balance, withdrawable } = await getPointBalance() // 적립금 잔액 조회

  // temp: 임시임 추후에는 pending이라는 상태명으로 들어올 예정
  const pendingPoints = balance - withdrawable // 적립 예정 포인트 (출금 가능일 미도달)

  const defaultBnplProfile =
    bnplProfiles?.find((profile) => profile.isDefault) ?? null // 나중결제 계좌 중 내가 기본으로 설정한 계좌 조회

  return (
    <div className="p x-3 rounded-xl bg-white pt-4 pb-9 md:px-6">
      <PageTitle>결제수단 관리</PageTitle>

      <div className="bg-gray-10 mt-5 mb-4 space-y-4 p-4">
        {/* 나중결제 내역 */}
        <BnplSection
          bnplProfiles={bnplProfiles ?? []}
          hasError={bnplProfiles === null}
        />

        {/* 적립금 섹션 */}
        <PointSection withdrawable={withdrawable} />

        {/* 계좌 섹션 */}
        <AccountSection
          defaultBnplProfile={defaultBnplProfile}
          hasError={bnplProfiles === null}
        />

        {/* 적립 예정인 적립금 섹션 */}
        <PendingPointsSection pendingPoints={pendingPoints} />
      </div>

      {/* 하단 메뉴 리스트 */}
      <PaymentMenuList />

      {/* 등록 모달 */}
      <BnplVerificationWizard
        user={currentUser}
        verificationStatus={verificationStatus}
        businessInfo={businessInfo}
        bnplProfiles={bnplProfiles ?? []}
      />

      {/* 결제 수단 등록 모달 */}
      <BankAccountWizard user={currentUser} />
    </div>
  )
}
