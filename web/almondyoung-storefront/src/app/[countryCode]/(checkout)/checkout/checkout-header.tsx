"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import Image from "next/image"
import { useTranslations } from "next-intl"

export default function CheckoutHeader({ title }: { title: string }) {
  const t = useTranslations("checkout")
  return (
    <header className="flex w-full items-center justify-center self-stretch bg-white px-4 py-3 shadow-sm sm:px-10 sm:py-5">
      <div className="flex w-full max-w-6xl items-center justify-between">
        <LocalizedClientLink href="/" className="shrink-0">
          <Image
            src="/images/almond-logo.png"
            width={1024}
            height={386}
            className="h-8 w-auto object-contain sm:h-10"
            alt={t("logoAlt")}
          />
        </LocalizedClientLink>

        <p className="flex-1 text-right text-lg font-bold text-black md:text-center md:text-2xl">
          {title}
        </p>

        <div
          className="w-0 shrink-0 md:h-10 md:w-[106px]"
          aria-hidden
        />
      </div>
    </header>
  )
}
