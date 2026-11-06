import Link from "next/link"
import { cn } from "@lib/utils"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { getTranslations } from "next-intl/server"

const CS_PHONE = "1877-7184"
const CS_PHONE_LINK = "tel:18777184"
const KAKAO_CHANNEL_URL = "https://pf.kakao.com/_xaxgxazs"
const INSTAGRAM_URL = "https://www.instagram.com/almondyoung_official/"
const COMPANY_SITE_URL = "https://www.lcnine.kr/"

const BUSINESS_LINES = [
  ["companyAndCeo", "bizNo", "mailOrderNo", "phone"],
  ["address", "email", "hosting"],
  ["medicalTarget", "medicalInstitution", "medicalAddress"],
  ["medicalSubjects", "medicalDirector", "privacyOfficer"],
] as const

const linkClassName = "hover:text-ink hover:underline"
const channelClassName =
  "flex h-10 items-center rounded-[10px] border border-border bg-white px-3.5 text-[13px] font-semibold text-ink hover:bg-muted"

export default async function Footer({ className }: { className?: string }) {
  const t = await getTranslations("footer")

  return (
    <footer className={cn("bg-muted border-border w-full border-t", className)}>
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 px-4 pt-10 pb-28 md:grid-cols-[minmax(0,1fr)_auto] md:pb-12">
        <div className="min-w-0">
          <nav className="text-ink mb-5 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold">
            <Link
              href={COMPANY_SITE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClassName}
            >
              {t("company")}
            </Link>
            <LocalizedClientLink href="/terms" className={linkClassName}>
              {t("terms")}
            </LocalizedClientLink>
            <LocalizedClientLink
              href="/privacy"
              className={cn(linkClassName, "font-extrabold")}
            >
              {t("privacy")}
            </LocalizedClientLink>
            <LocalizedClientLink href="/guide" className={linkClassName}>
              {t("guide")}
            </LocalizedClientLink>
          </nav>

          <address
            aria-label={t("businessInfo")}
            className="text-muted-foreground text-xs leading-[1.8] not-italic [&_p]:text-xs [&_p]:leading-[1.8]"
          >
            {BUSINESS_LINES.map((line) => (
              <p key={line[0]}>
                {line.map((key, index) => (
                  <span key={key}>
                    {index > 0 && (
                      <span aria-hidden="true" className="mx-1.5">
                        |
                      </span>
                    )}
                    {t(`business.${key}`)}
                  </span>
                ))}
              </p>
            ))}
            <p className="mt-3">{t("copyright")}</p>
          </address>
        </div>

        <section className="text-left md:text-right">
          <p className="text-muted-foreground text-[13px]">{t("csLabel")}</p>
          <Link
            href={CS_PHONE_LINK}
            className="text-ink block text-[26px] font-extrabold tracking-[-0.02em]"
          >
            {CS_PHONE}
          </Link>
          <div className="mt-3 flex gap-2 md:justify-end">
            <Link
              href={KAKAO_CHANNEL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={channelClassName}
            >
              {t("kakaoChannel")}
            </Link>
            <Link
              href={INSTAGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={channelClassName}
            >
              {t("instagram")}
            </Link>
          </div>
        </section>
      </div>
    </footer>
  )
}
