import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { DeleteEntryButton } from "@/domains/logo-contest/components/delete-entry-button"
import {
  getLogoContestEntry,
  getLogoContestStatus,
  getMyLogoContestState,
} from "@/lib/api/ugc/logo-contest"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { WithHeaderLayout } from "@components/layout"
import { getTranslations } from "next-intl/server"
import Image from "next/image"

export default async function MyContestsPage() {
  const t = await getTranslations("mypage.contests")
  const [state, status] = await Promise.all([
    getMyLogoContestState().catch(() => null),
    getLogoContestStatus().catch(() => null),
  ])
  const votedEntry = state?.votedEntryId
    ? await getLogoContestEntry(state.votedEntryId).catch(() => null)
    : null
  const myEntry = state?.entry

  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: t("title"),
      }}
    >
      <MypageLayout>
        <div className="px-4 py-6 md:px-0 md:py-0">
          <h1 className="text-2xl font-bold text-gray-900">{t("title")}</h1>
          <p className="mt-2 text-sm text-gray-500">{t("description")}</p>

          <section className="mt-8 overflow-hidden rounded-2xl border border-gray-200">
            <div className="flex items-center justify-between gap-4 border-b border-gray-200 px-5 py-4 sm:px-6">
              <h2 className="text-lg font-semibold text-gray-900">
                {t("logoContest")}
              </h2>
              <LocalizedClientLink
                href="/logo-contest"
                className="text-sm font-medium text-gray-600 underline-offset-4 hover:underline"
              >
                {t("viewContest")}
              </LocalizedClientLink>
            </div>

            {state === null ? (
              <p className="px-5 py-12 text-sm text-gray-500 sm:px-6">
                {t("loadFail")}
              </p>
            ) : myEntry || votedEntry ? (
              <div className="divide-y divide-gray-100">
                {myEntry && (
                  <div className="flex flex-col gap-5 p-5 sm:flex-row sm:p-6">
                    {myEntry.mediaFileIds[0] && (
                      <LocalizedClientLink
                        href={`/logo-contest/${myEntry.id}`}
                        className="relative aspect-[4/3] w-full shrink-0 overflow-hidden rounded-xl bg-gray-50 sm:w-44"
                      >
                        <Image
                          src={getThumbnailUrl(myEntry.mediaFileIds[0])}
                          alt={myEntry.title}
                          fill
                          sizes="(min-width: 640px) 176px, 100vw"
                          className="object-contain p-3"
                        />
                      </LocalizedClientLink>
                    )}
                    <div className="flex min-w-0 flex-1 flex-col items-start">
                      <p className="text-xs font-semibold text-gray-500">
                        {t("submitted")}
                      </p>
                      <LocalizedClientLink
                        href={`/logo-contest/${myEntry.id}`}
                        className="mt-2 text-lg font-semibold text-gray-900 hover:underline"
                      >
                        {myEntry.title}
                      </LocalizedClientLink>
                      <p className="mt-2 text-sm leading-6 text-gray-500">
                        {t("entryNotice")}
                      </p>
                      {status && !status.isClosed && (
                        <div className="mt-5">
                          <DeleteEntryButton entryId={myEntry.id} />
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {votedEntry && (
                  <div className="p-5 sm:p-6">
                    <p className="text-xs font-semibold text-gray-500">
                      {t("voted")}
                    </p>
                    <LocalizedClientLink
                      href={`/logo-contest/${votedEntry.id}`}
                      className="mt-2 block text-base font-semibold text-gray-900 hover:underline"
                    >
                      {votedEntry.title}
                    </LocalizedClientLink>
                  </div>
                )}
              </div>
            ) : (
              <div className="px-5 py-12 sm:px-6">
                <p className="text-sm text-gray-600">{t("empty")}</p>
                <LocalizedClientLink
                  href="/logo-contest"
                  className="mt-4 inline-block rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white"
                >
                  {t("browse")}
                </LocalizedClientLink>
              </div>
            )}
          </section>
        </div>
      </MypageLayout>
    </WithHeaderLayout>
  )
}
