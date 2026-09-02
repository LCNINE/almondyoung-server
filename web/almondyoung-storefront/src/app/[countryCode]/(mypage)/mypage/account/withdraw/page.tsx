import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { PageTitle } from "@/components/shared/page-title"
import { WithdrawForm } from "@/domains/mypage/components/account/withdraw-form"
import { WithHeaderLayout } from "@components/layout"
import {
  getCancellationPreview,
  getCurrentSubscription,
} from "@lib/api/membership"
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

  // 이용 중인 멤버십이 있으면 탈퇴 전에 해지를 거치도록 안내한다. 탈퇴 경로에는 환불 방식·수취
  // 계좌를 물어볼 자리가 없어 환불을 집행할 수 없고, 그대로 탈퇴하면 환급 기회가 사라진다.
  //
  // 환불 가능 여부까지 보고 문구를 가른다 — 정책상 환급액이 0원인 회원(대부분)에게 "환불받으려면
  // 먼저 해지하세요" 라고 하면, 받을 수 없는 환불을 문의하게 만든다. 판정 기준은 해지 화면이
  // 쓰는 것과 같은 서버 견적이라 두 화면의 안내가 어긋나지 않는다.
  //
  // 조회가 실패해도 탈퇴 자체는 막지 않는다 — 안내만 빠진다.
  const [subscription, preview] = await Promise.all([
    getCurrentSubscription().catch(() => null),
    getCancellationPreview().catch(() => null),
  ])
  const hasMembership = !!subscription
  const hasRefundableAmount = (preview?.options ?? []).some(
    (option) => option.available && option.refundAmount > 0
  )

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
          <WithdrawForm
            countryCode={countryCode}
            hasMembership={hasMembership}
            hasRefundableAmount={hasRefundableAmount}
          />
        </div>
      </MypageLayout>
    </WithHeaderLayout>
  )
}
