import type { Metadata } from "next"
import Image from "next/image"
import { getTranslations } from "next-intl/server"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { CartRefresher } from "./cart-refresher"
import { BackButton } from "./back-button"

const RECOMMEND_CARDS = [
  // 웰컴딜 재개 시 주석 해제
  // {
  //   titleKey: "welcomeDeal",
  //   href: "/category/cafe24-cat-498",
  //   image: "/images/membership-done/card-welcome-deal.png",
  // },
  {
    titleKey: "exclusiveProducts",
    href: "/category/membership-canva",
    image: "/images/membership-done/card-members-only.png",
  },
  {
    titleKey: "downloadDaview",
    href: "https://dabeau.kr/sign-in",
    image: "/images/membership-done/card-daview.png",
  },
] as const

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("mypage.membershipSubscribe")
  return { title: t("metaSuccess") }
}

export default async function MembershipSuccessScreen() {
  const t = await getTranslations("mypage.membershipSubscribe")
  return (
    <div className="flex flex-col bg-white">
      <CartRefresher />
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
          <section
            aria-labelledby="welcome-title"
            className="flex flex-col items-center px-1 text-center"
          >
            <div className="relative w-[270px] max-w-full sm:w-[320px]">
              <Image
                src="/images/membership-welcome-penguins-v3.png"
                alt=""
                width={720}
                height={720}
                priority
                className="h-auto w-full"
              />
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 h-[45%] bg-gradient-to-t from-white via-white/85 to-transparent [mask-image:linear-gradient(to_top,black_40%,transparent)] backdrop-blur-[3px]"
              />
            </div>
            <h2
              id="welcome-title"
              className="text-foreground relative z-10 -mt-16 text-[30px] leading-[41px] font-normal tracking-[-0.3px] sm:-mt-[72px] sm:text-[34px] sm:leading-[46px]"
            >
              {t("welcomeLine1")}
              <br />
              <span className="font-bold">{t("welcomeStrong")}</span>
              {t("welcomeLineSuffix")}
              <br />
              {t("welcomeLine3")}
            </h2>
          </section>

          <div className="mt-11 grid grid-cols-2 gap-[19px]">
            {RECOMMEND_CARDS.map((card) => {
              const body = (
                <>
                  <p className="text-foreground text-[15px] leading-[21px] font-medium tracking-[-0.15px] break-keep">
                    {t(card.titleKey)}
                  </p>
                  <div className="relative -mx-[17.5%] aspect-square w-[135%] shrink-0 sm:mx-0 sm:w-full">
                    <Image
                      src={card.image}
                      alt=""
                      fill
                      sizes="(min-width: 540px) 240px, 45vw"
                      className="pointer-events-none object-contain drop-shadow-[0_18px_24px_rgba(0,0,0,0.24)]"
                    />
                  </div>
                </>
              )
              const cardClass =
                "flex h-[207px] flex-col items-start gap-[16px] rounded-[10px] border-[0.5px] border-[#d9d9d9] px-[10px] py-[15px]"
              const linkClass = `${cardClass} transition-colors hover:bg-black/[0.02]`
              return card.href.startsWith("http") ? (
                <a
                  key={card.titleKey}
                  href={card.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkClass}
                >
                  {body}
                </a>
              ) : (
                <LocalizedClientLink
                  key={card.titleKey}
                  href={card.href}
                  className={linkClass}
                >
                  {body}
                </LocalizedClientLink>
              )
            })}
          </div>
        </div>

        <footer className="relative z-10 w-full shrink-0 pt-12 pb-4">
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
