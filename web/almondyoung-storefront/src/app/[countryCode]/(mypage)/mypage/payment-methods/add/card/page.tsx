import { AddCardForm } from "domains/payment-methods"
import { WithHeaderLayout } from "@components/layout"
import MypageLayout from "@components/layout/mypage-layout"

export default function AddCardPage() {
  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
      }}
    >
      <MypageLayout>
        <div className="min-h-screen bg-white py-4 md:px-6">
          <AddCardForm />
        </div>
      </MypageLayout>
    </WithHeaderLayout>
  )
}
