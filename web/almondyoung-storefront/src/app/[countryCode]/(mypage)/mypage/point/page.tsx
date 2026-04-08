import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { WithHeaderLayout } from "@/components/layout"

export default function PointPage() {
  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: "포인트 적립",
      }}
    >
      <MypageLayout>
        <div className="min-h-screen w-full bg-white font-['Pretendard'] text-black">
          <div className="mx-auto min-h-screen max-w-md bg-white">
            <main>포인트페이지</main>
          </div>
        </div>
      </MypageLayout>
    </WithHeaderLayout>
  )
}
