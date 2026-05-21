import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { getSEOTags } from "@/lib/seo"
import { WithHeaderLayout } from "@components/layout"
import { getOwnerships } from "@lib/api/library/library-api"
import { fetchMe } from "@lib/api/users/me"
import { UserDetail } from "@lib/types/ui/user"
import type { OwnershipFilter } from "@lib/types/dto/library.dto"
import { AlertCircle } from "lucide-react"
import { getTranslations } from "next-intl/server"
import DownloadPageTemplate from "domains/download/download-page-template"

export async function generateMetadata() {
  const t = await getTranslations("mypage.page")
  return getSEOTags({
    title: t("download"),
    openGraph: {},
  })
}

export default async function DownloadPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; is_exercised?: string | null }>
}) {
  const t = await getTranslations("mypage.page")
  const currentUser = await fetchMe()
  const params = await searchParams
  const page = Number(params.page) || 1
  const take = 12
  const skip = (page - 1) * take
  const is_exercised = params.is_exercised ?? null

  const filter: OwnershipFilter =
    is_exercised === "false" ? "new" : is_exercised === "true" ? "used" : "all"

  try {
    const ownerships = await getOwnerships({ skip, take, filter })

    return (
      <WithHeaderLayout
        config={{
          showDesktopHeader: true,
          showMobileHeader: false,
          showMobileSubBackHeader: true,
          mobileSubBackHeaderTitle: t("download"),
        }}
      >
        <MypageLayout>
          <DownloadPageTemplate
            user={currentUser as UserDetail}
            ownerships={ownerships.data}
            total={ownerships.total}
            currentPage={page}
            itemsPerPage={take}
            is_exercised={is_exercised}
          />
        </MypageLayout>
      </WithHeaderLayout>
    )
  } catch {
    return (
      <WithHeaderLayout
        config={{
          showDesktopHeader: true,
          showMobileHeader: false,
          showMobileSubBackHeader: true,
          mobileSubBackHeaderTitle: t("download"),
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
      </div>
    </div>
  )
}
