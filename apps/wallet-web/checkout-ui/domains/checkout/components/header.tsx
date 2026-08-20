"use client"

import Link from "next/link"
import Image from "next/image"
import { useTranslations } from "next-intl"

export const PCHeader = () => {
  const t = useTranslations("checkout.header")
  const tCheckout = useTranslations("checkout")
  const storefrontOrigin = process.env.NEXT_PUBLIC_STOREFRONT_ORIGIN ?? "/"
  return (
    <div className="hidden w-full border-b border-gray-200 bg-white lg:block">
      <div className="relative container mx-auto flex max-w-[1360px] items-center justify-between px-[40px] py-5">
        <Link href={storefrontOrigin} className="shrink-0">
          <Image
            src="/images/almond-logo-black.png"
            alt={tCheckout("logoAltAlmondyoung")}
            className="h-7 w-auto"
            width={200}
            height={150}
          />
        </Link>
        <h1 className="absolute left-1/2 -translate-x-1/2 transform text-2xl font-bold">
          {t("title")}
        </h1>
        <div className="w-[200px] shrink-0"></div>
      </div>

      <div className="container mx-auto max-w-[1360px] px-4 py-3 lg:px-[40px]">
        <div className="flex items-center justify-end gap-2">
          <span className="font-bold text-gray-900">{t("breadcrumbCurrent")}</span>
          <svg
            className="h-6 w-6 text-gray-300"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
          <span className="text-gray-500">{t("breadcrumbDone")}</span>
        </div>
      </div>
    </div>
  )
}

export const MobileHeader = ({ onClose }: { onClose: () => void }) => {
  const t = useTranslations("checkout.header")
  return (
    <header className="relative mb-6 flex items-center justify-center pt-6 lg:hidden">
      <button
        aria-label={t("closeAria")}
        className="absolute left-0 flex h-8 w-8 items-center justify-center text-gray-900"
        onClick={onClose}
      >
        <svg
          className="h-6 w-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 19l-7-7 7-7"
          />
        </svg>
      </button>
      <h1 className="text-lg font-bold text-gray-900">{t("mobileTitle")}</h1>
    </header>
  )
}
