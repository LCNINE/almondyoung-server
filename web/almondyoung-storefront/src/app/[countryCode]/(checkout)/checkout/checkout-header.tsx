"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import Image from "next/image"

export default function CheckoutHeader({ title }: { title: string }) {
  return (
    <header className="flex w-full items-center justify-center self-stretch bg-white px-4 py-3 shadow-sm sm:px-10 sm:py-5">
      <div className="flex w-full max-w-6xl items-center justify-between">
        <LocalizedClientLink href="/" className="shrink-0">
          <Image
            src="/images/almond-logo-black.png"
            width={218}
            height={29}
            className="h-5 w-auto object-contain sm:h-[29px] sm:w-[218px]"
            alt="아몬드 로고"
          />
        </LocalizedClientLink>

        <p className="flex-1 text-right text-lg font-bold text-black md:text-center md:text-2xl">
          {title}
        </p>

        <div
          className="w-0 shrink-0 md:h-[29px] md:w-[218px]"
          aria-hidden
        />
      </div>
    </header>
  )
}
