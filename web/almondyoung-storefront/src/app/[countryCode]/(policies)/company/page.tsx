import { Metadata } from "next"
import { getTranslations } from "next-intl/server"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("policies.company")
  return { title: t("title") }
}

export default async function CompanyPage() {
  const t = await getTranslations("policies.company")

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-8 text-2xl font-bold">{t("title")}</h1>

      <section className="space-y-6">
        <div>
          <h2 className="mb-3 text-lg font-semibold">{t("companyName")}</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {t("intro")}
          </p>
        </div>

        <div className="border-t pt-6">
          <h2 className="mb-3 text-lg font-semibold">{t("sectionTitle")}</h2>
          <dl className="text-muted-foreground space-y-2 text-sm">
            <div className="flex gap-2">
              <dt className="text-foreground w-32 shrink-0 font-medium">
                {t("fieldCompanyName")}
              </dt>
              <dd>{t("companyName")}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-foreground w-32 shrink-0 font-medium">
                {t("fieldCeo")}
              </dt>
              <dd>{t("ceoName")}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-foreground w-32 shrink-0 font-medium">
                {t("fieldBizNo")}
              </dt>
              <dd>467-86-01638</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-foreground w-32 shrink-0 font-medium">
                {t("fieldMailOrderNo")}
              </dt>
              <dd>2019-서울영등포-1446</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-foreground w-32 shrink-0 font-medium">
                {t("fieldPhone")}
              </dt>
              <dd>1877-7184</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-foreground w-32 shrink-0 font-medium">
                {t("fieldAddress")}
              </dt>
              <dd>경기도 부천시 평천로832번길 42 (도당동) 4층 엘씨나인</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-foreground w-32 shrink-0 font-medium">
                {t("fieldPrivacyOfficer")}
              </dt>
              <dd>주식회사 엘씨나인 (hello@lcnine.kr)</dd>
            </div>
          </dl>
        </div>
      </section>
    </div>
  )
}
