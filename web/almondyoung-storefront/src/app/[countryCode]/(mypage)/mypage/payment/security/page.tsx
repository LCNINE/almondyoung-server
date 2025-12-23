import { Spinner } from "@components/common/spinner"
import { WithHeaderLayout } from "@components/layout"
import MypageLayout from "@components/layout/mypage-layout"
import ProtectedRoute from "@components/protected-route"
import { Suspense } from "react"
import SecurityManager from "../(components)/sucurity-manager"

export default async function SecurityPage() {
  return (
    <ProtectedRoute>
      <WithHeaderLayout
        config={{
          showDesktopHeader: true,
          showMobileHeader: false,
          showMobileSubBackHeader: true,
          mobileSubBackHeaderTitle: "비밀번호 설정",
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
            <SecurityManager />
          </Suspense>
        </MypageLayout>
      </WithHeaderLayout>
    </ProtectedRoute>
  )
}
