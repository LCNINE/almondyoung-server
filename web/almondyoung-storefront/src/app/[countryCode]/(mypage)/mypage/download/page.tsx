import { WithHeaderLayout } from "@components/layout"
import MypageLayout from "@components/layout/mypage-layout"
import { getDigitalAssets } from "@lib/api/medusa/digital-asset"
import { fetchMe } from "@lib/api/users/me"
import { UserDetail } from "domains/auth/types"
import DownloadPageTemplate from "domains/mypage/template/download-page-template"
import { AlertCircle } from "lucide-react"
import { Metadata } from "next"

export const metadata: Metadata = {
  title: "다운로드",
  description: "다운로드 내역을 확인하세요",
}

export default async function DownloadPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; is_exercised?: string }>
}) {
  const currentUser = await fetchMe()
  const params = await searchParams
  const page = Number(params.page) || 1
  const take = 12
  const skip = (page - 1) * take
  const is_exercised = params.is_exercised ?? null

  try {
    const digitalAssets = await getDigitalAssets(skip, take)

    return (
      <WithHeaderLayout
        config={{
          showDesktopHeader: true,
          showMobileHeader: false,
          showMobileSubBackHeader: true,
          mobileSubBackHeaderTitle: "다운로드",
        }}
      >
        <MypageLayout>
          <DownloadPageTemplate
            user={currentUser as UserDetail}
            digitalAssets={digitalAssets.data.licenses}
            currentPage={page}
            itemsPerPage={take}
            is_exercised={is_exercised}
          />
        </MypageLayout>
      </WithHeaderLayout>
    )
  } catch (err) {
    return (
      <WithHeaderLayout
        config={{
          showDesktopHeader: true,
          showMobileHeader: false,
          showMobileSubBackHeader: true,
          mobileSubBackHeaderTitle: "다운로드",
        }}
      >
        <MypageLayout>
          <DownloadPageError />
        </MypageLayout>
      </WithHeaderLayout>
    )
  }
}

function DownloadPageError() {
  return (
    <div className="bg-background flex min-h-[60vh] items-center justify-center px-4 py-12">
      <div className="w-full max-w-md text-center">
        <div className="mb-6 flex justify-center">
          <div className="bg-destructive/10 flex h-20 w-20 items-center justify-center rounded-full">
            <AlertCircle className="text-destructive h-10 w-10" />
          </div>
        </div>

        {/* 에러 메시지 */}
        <h2 className="mb-3 text-2xl font-bold">데이터를 불러올 수 없습니다</h2>
        <p className="text-muted-foreground mb-8 text-sm">
          다운로드 내역을 불러오는 중 문제가 발생했습니다.
          <br />
          잠시 후 다시 시도해주세요.
        </p>

        {/* 추가 도움말 */}
        <div className="bg-muted mt-8 rounded-lg p-4 text-left">
          <p className="text-muted-foreground mb-2 text-xs font-semibold">
            문제가 계속되나요?
          </p>
          <ul className="text-muted-foreground space-y-1 text-xs">
            <li>• 인터넷 연결을 확인해주세요</li>
            <li>• 로그인 상태를 확인해주세요</li>
            <li>• 브라우저를 새로고침해주세요</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
