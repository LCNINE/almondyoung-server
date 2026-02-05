import { Spinner } from "@/components/shared/spinner"
import { WithHeaderLayout } from "@components/layout"
import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import PaymentManager from "domains/payment/payment-management"
import { Suspense } from "react"

export default function PaymentPage() {
  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: "결제수단 관리",
      }}
    >
      <MypageLayout>
        <Suspense
          fallback={
            <div className="flex h-56 items-center justify-center text-center">
              <Spinner size="lg" color="gray" />
            </div>
          }
        >
          <PaymentManager />
        </Suspense>
      </MypageLayout>
    </WithHeaderLayout>
  )
}
