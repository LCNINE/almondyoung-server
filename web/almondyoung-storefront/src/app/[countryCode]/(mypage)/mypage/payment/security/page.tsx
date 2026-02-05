import { Spinner } from "@/components/shared/spinner"
import { WithHeaderLayout } from "@components/layout"
import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { Suspense } from "react"
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
        <Suspense
          fallback={
            <div className="flex h-56 items-center justify-center text-center">
              <Spinner size="lg" color="gray" />
            </div>
          }
        >
          <SecurityManager redirectTo={redirectTo} />
        </Suspense>
      </MypageLayout>
    </WithHeaderLayout>
  )
}
