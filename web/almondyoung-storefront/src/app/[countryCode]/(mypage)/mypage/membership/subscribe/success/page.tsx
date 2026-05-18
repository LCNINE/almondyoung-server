import type { Metadata } from "next"
import Image from "next/image"
import { getTranslations } from "next-intl/server"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { CartRefresher } from "./cart-refresher"
import { BackButton } from "./back-button"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("mypage.membershipSubscribe")
  return { title: t("metaSuccess") }
}

export default async function MembershipSuccessScreen() {
  const t = await getTranslations("mypage.membershipSubscribe")
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <CartRefresher />
      <div className="mx-auto flex w-full flex-1 flex-col px-6">
        <header className="flex w-full shrink-0 items-center border-b border-gray-200 px-3 py-4 md:px-6 md:py-3">
          <div className="flex-1">
            <BackButton />
          </div>
          <h1 className="flex-1 text-center text-base font-bold text-black">
            {t("successTitle")}
          </h1>
          <div className="flex-1" />
        </header>

        <div className="flex-1 py-10">
          <div className="flex flex-col gap-12">
            <section
              aria-labelledby="welcome-title"
              className="flex flex-col items-center gap-4 text-center"
            >
              <Image
                className="h-20 w-20"
                src="https://placehold.co/80x80"
                alt={t("celebrationAlt")}
                width={80}
                height={80}
              />
              <h2
                id="welcome-title"
                className="text-3xl leading-snug text-black"
              >
                {t("welcomeLine1")}
                <br />
                <span className="font-bold">{t("welcomeStrong")}</span>
                {t("welcomeLineSuffix")}
                <br />
                {t("welcomeLine3")}
              </h2>
            </section>

            <section aria-labelledby="recommend-links-title">
              <h3 id="recommend-links-title" className="sr-only">
                {t("recommendLinksTitle")}
              </h3>

              <div className="mx-auto flex gap-4 px-6 py-4">
                <a
                  href="#"
                  className="flex w-32 shrink-0 flex-col gap-4 rounded-lg border border-gray-300 p-3.5"
                >
                  <p className="text-base leading-5 font-medium text-black">
                    {t("welcomeDeal")}
                  </p>
                  <Image
                    className="h-28 w-full rounded object-cover"
                    src="https://placehold.co/111x111"
                    alt=""
                    width={111}
                    height={111}
                  />
                </a>

                <a
                  href="#"
                  className="flex w-32 shrink-0 flex-col gap-4 rounded-lg border border-gray-300 p-3.5"
                >
                  <p className="text-base leading-5 font-medium text-black">
                    {t("exclusiveProducts")}
                  </p>
                  <Image
                    className="h-28 w-full rounded object-cover"
                    src="https://placehold.co/111x111"
                    alt=""
                    width={111}
                    height={111}
                  />
                </a>

                <a
                  href="#"
                  className="flex w-32 shrink-0 flex-col gap-9 rounded-lg border border-gray-300 p-3.5"
                >
                  <p className="text-base leading-5 font-medium text-black">
                    {t("downloadDaview")}
                  </p>
                  <Image
                    className="h-28 w-full rounded object-cover"
                    src="https://placehold.co/111x111"
                    alt=""
                    width={111}
                    height={111}
                  />
                </a>
              </div>
            </section>
          </div>
        </div>

        <footer className="w-full shrink-0 border-t border-gray-200 bg-white py-4">
          <LocalizedClientLink
            href="/"
            className="block w-full rounded-md bg-amber-500 px-4 py-3 text-center text-sm leading-5 font-semibold text-white transition-colors hover:bg-amber-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600"
          >
            {t("continueShopping")}
          </LocalizedClientLink>
        </footer>
      </div>
    </div>
  )
}
