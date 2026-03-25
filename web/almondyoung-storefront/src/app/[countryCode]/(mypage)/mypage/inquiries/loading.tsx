import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { Skeleton } from "@/components/ui/skeleton"
import { WithHeaderLayout } from "@components/layout"

export default function Loading() {
  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: "내 문의 내역",
      }}
    >
      <MypageLayout>
        <div className="bg-white md:p-6">
          <Skeleton className="mb-6 h-8 w-40" />
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="border-b border-gray-100 py-4">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="h-4 w-4" />
                </div>
                <Skeleton className="mt-2 h-5 w-3/4" />
                <Skeleton className="mt-2 h-4 w-32" />
              </div>
            ))}
          </div>
        </div>
      </MypageLayout>
    </WithHeaderLayout>
  )
}
