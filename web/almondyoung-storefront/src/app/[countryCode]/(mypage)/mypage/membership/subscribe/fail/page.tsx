import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import LocalizedClientLink from "@/components/shared/localized-client-link"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("mypage.membershipSubscribe")
  return { title: t("metaFail") }
}

export default async function PaymentFailedScreen({
  searchParams,
}: {
  params: Promise<{ countryCode: string }>
  searchParams: Promise<{ code?: string; message?: string }>
}) {
  const t = await getTranslations("mypage.membershipSubscribe")
  const { code, message } = await searchParams
  const displayMessage =
    message && message.trim().length > 0
      ? message
      : t("defaultFailMessage")
  return (
    <div className="flex min-h-screen flex-col bg-white font-['Pretendard']">
      <div className="mx-auto flex w-full flex-1 flex-col px-6">
        <div className="flex-1 overflow-y-auto py-10">
          <div className="flex flex-col gap-8">
            <section aria-labelledby="payment-failed-title">
              <h1
                id="payment-failed-title"
                className="text-center text-2xl leading-tight font-bold text-black"
              >
                {t("failTitle")}
              </h1>
            </section>

            <section aria-labelledby="payment-failure-reason">
              <h2 id="payment-failure-reason" className="sr-only">
                {t("failReasonHeading")}
              </h2>
              <p className="text-sm leading-relaxed text-gray-800">
                {displayMessage}
              </p>
              {code && (
                <p className="mt-2 text-xs text-gray-500">{t("errorCode", { code })}</p>
              )}
            </section>
          </div>
        </div>

        <footer className="w-full flex-shrink-0 py-4">
          <LocalizedClientLink
            href="/mypage/membership/subscribe/payment"
            className="block w-full rounded-md bg-amber-500 px-4 py-3 text-center text-sm leading-5 font-semibold text-white transition-colors hover:bg-amber-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600"
          >
            {t("retryPayment")}
          </LocalizedClientLink>
        </footer>
      </div>
    </div>
  )
}
