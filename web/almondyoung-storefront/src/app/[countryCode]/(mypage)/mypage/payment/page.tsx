import { Spinner } from "@components/common/spinner"
import { WithHeaderLayout } from "@components/layout"
import MypageLayout from "@components/layout/mypage-layout"
import ProtectedRoute from "@components/protected-route"
import PaymentManagement from "domains/payment/payment-management"
import { Suspense } from "react"

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
          <Suspense
            fallback={
              <div className="flex h-56 items-center justify-center text-center">
                <Spinner size="lg" color="gray" />
              </div>
            }
          >
            <PaymentManagement />
          </Suspense>
        </MypageLayout>
      </WithHeaderLayout>
    </ProtectedRoute>
  )
}
