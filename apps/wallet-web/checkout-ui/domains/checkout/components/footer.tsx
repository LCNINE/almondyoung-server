"use client"

import { useTranslations } from "next-intl"

const DOC_LINKS = [
  { key: "terms", path: "terms" },
  { key: "privacy", path: "privacy" },
  { key: "guide", path: "guide" },
] as const

const BUSINESS_ROWS = [
  "companyAndCeo",
  "bizNo",
  "mailOrderNo",
  "phone",
  "address",
  "email",
] as const

export const CheckoutFooter = ({ countryCode }: { countryCode: string }) => {
  const t = useTranslations("checkout.footer")
  const origin = process.env.NEXT_PUBLIC_STOREFRONT_ORIGIN ?? ""

  return (
    <footer className="border-t border-gray-200">
      <div className="container mx-auto max-w-[1080px] px-4 py-8 lg:px-0 lg:py-10 lg:pb-32">
        <nav className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] font-medium text-[#404048]">
          <span>{t("cs")}</span>
          {DOC_LINKS.map((link) => (
            <span key={link.key} className="flex items-center gap-x-3">
              <span aria-hidden className="text-gray-300">
                |
              </span>
              <a
                href={`${origin}/${countryCode}/${link.path}`}
                target="_blank"
                rel="noopener noreferrer"
                className={
                  link.key === "privacy" ? "font-bold hover:underline" : "hover:underline"
                }
              >
                {t(link.key)}
              </a>
            </span>
          ))}
        </nav>

        <details className="mt-6 group">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 text-[13px] font-bold text-[#404048]">
            {t("businessInfo")}
            <svg
              aria-hidden
              className="h-4 w-4 text-gray-400 transition-transform group-open:rotate-180"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </summary>
          <dl className="mt-4 space-y-2 text-[12px] font-medium text-[#767678]">
            {BUSINESS_ROWS.map((row) => (
              <div key={row}>{t(`business.${row}`)}</div>
            ))}
          </dl>
        </details>

        <p className="mt-6 text-[12px] font-medium text-[#929294]">
          {t("copyright")}
        </p>
      </div>
    </footer>
  )
}
