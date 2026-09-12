import { getTranslations } from "next-intl/server"
import { Skeleton } from "@/components/ui/skeleton"
import { BackButton } from "./back-button"

export default async function Loading() {
  const t = await getTranslations("mypage.membershipSubscribe")
  return (
    <div className="flex flex-col bg-white">
      <div className="mx-auto flex w-full max-w-[540px] flex-col px-6">
        <header className="flex w-full shrink-0 items-center border-b border-gray-200 px-3 py-4 md:px-6 md:py-3">
          <div className="flex-1">
            <BackButton />
          </div>
          <h1 className="flex-1 text-center text-base font-bold text-black">
            {t("successTitle")}
          </h1>
          <div className="flex-1" />
        </header>

        <div className="flex flex-col py-0">
          <section className="flex flex-col items-center px-1 pt-6">
            <Skeleton className="h-[128px] w-[220px] max-w-full rounded-[28px] sm:h-[150px] sm:w-[260px]" />
            <div className="mt-7 flex flex-col items-center gap-3">
              <Skeleton className="h-[26px] w-[190px]" />
              <Skeleton className="h-[26px] w-[140px]" />
            </div>
          </section>

          <div className="mt-11 grid grid-cols-2 gap-[19px]">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-[207px] rounded-[10px]" />
            ))}
          </div>
        </div>

        <footer className="w-full shrink-0 bg-white py-4">
          <Skeleton className="h-[46px] w-full rounded-md" />
        </footer>
      </div>
    </div>
  )
}
