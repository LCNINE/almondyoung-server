import Link from "next/link"
import { cn } from "@lib/utils"
import { Button } from "@/components/ui/button"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { getTranslations } from "next-intl/server"
import { FooterInfoLine } from "./footer-info-line"

const CS_PHONE = "1877-7184"
const COMPANY_SITE_URL = "https://www.lcnine.kr/"

export default async function Footer({ className }: { className?: string }) {
  const t = await getTranslations("footer")

  return (
    <footer className={cn("w-full", className)}>
      {/* --- 데스크탑 뷰 --- */}
      <div className="hidden w-full bg-stone-200 md:block">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-8 text-stone-400 md:flex-row lg:gap-12">
          <section className="flex-1 md:max-w-sm">
            <h3 className="mb-4 text-lg font-bold text-stone-500">
              {t("csTitle", { phone: CS_PHONE })}
            </h3>
            <div className="flex flex-col gap-3">
              <div className="flex gap-4 text-sm">
                <Button
                  variant="link"
                  asChild
                  className="px-0 py-0 text-stone-400 hover:text-stone-700 hover:underline"
                >
                  <Link href="tel:18777184" target="_blank">
                    {t("callPhone")}
                  </Link>
                </Button>
                <Button
                  variant="link"
                  asChild
                  className="px-0 py-0 text-stone-400 hover:text-stone-700 hover:underline"
                >
                  <Link href="https://pf.kakao.com/_xaxgxazs" target="_blank">
                    {t("kakaoChatAdd")}
                  </Link>
                </Button>
                <Button
                  variant="link"
                  asChild
                  className="px-0 py-0 text-stone-400 hover:text-stone-700 hover:underline"
                >
                  <Link
                    href="https://www.instagram.com/almondyoung_official/"
                    target="_blank"
                  >
                    {t("instagram")}
                  </Link>
                </Button>
              </div>
              <nav className="flex flex-wrap gap-4 text-sm">
                <Link
                  href={COMPANY_SITE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-stone-700 hover:underline"
                >
                  {t("company")}
                </Link>
                <LocalizedClientLink
                  href="/terms"
                  className="hover:text-stone-700 hover:underline"
                >
                  {t("terms")}
                </LocalizedClientLink>
                <LocalizedClientLink
                  href="/privacy"
                  className="font-bold text-stone-600 hover:text-stone-800 hover:underline"
                >
                  {t("privacy")}
                </LocalizedClientLink>
                <LocalizedClientLink
                  href="/guide"
                  className="hover:text-stone-700 hover:underline"
                >
                  {t("guide")}
                </LocalizedClientLink>
              </nav>
              <p className="mt-4 text-sm">{t("copyright")}</p>
            </div>
          </section>
          <address className="flex-1 space-y-1 not-italic">
            <strong className="mb-2 block font-semibold text-stone-500">
              {t("businessInfo")}
            </strong>
            <FooterInfoLine>{t("business.companyAndCeo")}</FooterInfoLine>
            <FooterInfoLine>{t("business.bizNo")}</FooterInfoLine>
            <FooterInfoLine>{t("business.mailOrderNo")}</FooterInfoLine>
            <FooterInfoLine>{t("business.phone")}</FooterInfoLine>
            <FooterInfoLine>{t("business.address")}</FooterInfoLine>
          </address>
          <div className="flex-1 space-y-1">
            <FooterInfoLine>{t("business.medicalTarget")}</FooterInfoLine>
            <FooterInfoLine>{t("business.medicalInstitution")}</FooterInfoLine>
            <FooterInfoLine>{t("business.medicalAddress")}</FooterInfoLine>
            <FooterInfoLine>{t("business.medicalSubjects")}</FooterInfoLine>
            <FooterInfoLine>{t("business.medicalDirector")}</FooterInfoLine>
            <FooterInfoLine>{t("business.privacyOfficer")}</FooterInfoLine>
          </div>
        </div>
      </div>

      {/* --- 모바일 뷰 --- */}
      <div className="block md:hidden">
        <div className="border-t border-stone-100 bg-stone-50 px-5 pt-10 pb-28">
          <div className="text-left">
            {/* 고객센터 */}
            <section className="mb-8">
              <h3 className="mb-3 text-[15px] font-bold text-stone-800">
                {t("csTitle", { phone: CS_PHONE })}
              </h3>
              <div className="flex justify-start gap-4 text-sm font-medium text-stone-600">
                <button type="button" className="hover:text-stone-900">
                  {t("callPhone")}
                </button>
                <div className="h-3 w-px self-center bg-stone-300" />
                <button type="button" className="hover:text-stone-900">
                  {t("kakaoChat")}
                </button>
                <div className="h-3 w-px self-center bg-stone-300" />
                <button type="button" className="hover:text-stone-900">
                  {t("instagram")}
                </button>
              </div>
            </section>

            {/* 정책 링크 */}
            <nav className="mb-6 flex flex-wrap justify-start gap-x-4 gap-y-2 text-xs text-stone-500">
              <Link
                href={COMPANY_SITE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-stone-800"
              >
                {t("company")}
              </Link>
              <LocalizedClientLink href="/terms" className="hover:text-stone-800">
                {t("terms")}
              </LocalizedClientLink>
              <LocalizedClientLink
                href="/privacy"
                className="font-bold text-stone-700 hover:text-stone-900"
              >
                {t("privacy")}
              </LocalizedClientLink>
              <LocalizedClientLink href="/guide" className="hover:text-stone-800">
                {t("guide")}
              </LocalizedClientLink>
            </nav>

            {/* 회사 정보 */}
            <address className="space-y-1 text-[11px] leading-relaxed text-stone-400 not-italic">
              <p>{t("business.mobileCompany")}</p>
              <p>{t("business.mobileBizNo")}</p>
              <p>{t("business.mobileMailOrderNo")}</p>
              <p>{t("business.mobilePhone")}</p>
              <p>{t("business.mobileAddress")}</p>
            </address>

            <div className="mt-6 border-t border-stone-200 pt-4">
              <p className="text-[10px] text-stone-300">{t("copyright")}</p>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}
