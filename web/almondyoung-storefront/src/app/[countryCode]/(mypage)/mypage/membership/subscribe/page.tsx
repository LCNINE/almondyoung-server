import { WithHeaderLayout } from "@components/layout"
import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { Construction } from "lucide-react"

// 멤버십 플랜 선택 페이지
export default function MembershipSubscribePage() {
  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: "멤버십 가입",
      }}
    >
      <MypageLayout>
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 p-8">
          <Construction className="h-24 w-24 text-amber-500" />
          <div className="text-center">
            <h1 className="text-3xl font-bold text-gray-800">
              멤버십 가입 페이지 준비중
            </h1>
            <p className="mt-4 text-lg text-gray-600">
              더 나은 서비스를 제공하기 위해 준비 중입니다.
            </p>
            <p className="mt-2 text-sm text-gray-500">
              곧 멋진 멤버십 혜택과 함께 찾아뵙겠습니다!
            </p>
          </div>
        </div>
      </MypageLayout>
    </WithHeaderLayout>
  )
}
