import { Metadata } from "next"
import { getTranslations } from "next-intl/server"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("policies.guide")
  return { title: t("title") }
}

export default async function GuidePage() {
  const t = await getTranslations("policies.guide")

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-8 text-2xl font-bold">{t("title")}</h1>

      <div className="space-y-8">
        <section>
          <h2 className="mb-3 text-lg font-semibold">{t("payment.title")}</h2>
          <ul className="text-muted-foreground list-inside list-disc space-y-1.5 text-sm leading-relaxed">
            <li>{t("payment.item1")}</li>
            <li>{t("payment.item2")}</li>
            <li>{t("payment.item3")}</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">{t("shipping.title")}</h2>
          <ul className="text-muted-foreground list-inside list-disc space-y-1.5 text-sm leading-relaxed">
            <li>{t("shipping.item1")}</li>
            <li>{t("shipping.item2")}</li>
            <li>{t("shipping.item3")}</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">{t("return.title")}</h2>
          <ul className="text-muted-foreground list-inside list-disc space-y-1.5 text-sm leading-relaxed">
            <li>{t("return.item1")}</li>
            <li>{t("return.item2")}</li>
            <li>{t("return.item3")}</li>
            <li>{t("return.item4")}</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">{t("cs.title")}</h2>
          <ul className="text-muted-foreground list-inside list-disc space-y-1.5 text-sm leading-relaxed">
            <li>{t("cs.item1")}</li>
            <li>{t("cs.item2")}</li>
            <li>{t("cs.item3")}</li>
          </ul>
        </section>
      </div>
    </div>
  )
}
