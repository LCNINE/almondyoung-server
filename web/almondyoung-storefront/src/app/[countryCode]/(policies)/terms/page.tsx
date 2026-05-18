import { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { agreements } from "@/lib/data/agreements"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("policies.terms")
  return { title: t("title") }
}

export default async function TermsPage() {
  const t = await getTranslations("policies.terms")
  const termsOfService = agreements.find((a) => a.id === "termsOfService")
  const electronicTransaction = agreements.find(
    (a) => a.id === "electronicTransaction"
  )

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-8 text-2xl font-bold">{t("title")}</h1>

      {termsOfService?.content && (
        <section className="mb-12">
          <h2 className="mb-4 text-lg font-semibold">{t("almondTerms")}</h2>
          <div className="text-muted-foreground whitespace-pre-line text-sm leading-relaxed">
            {termsOfService.content}
          </div>
        </section>
      )}

      {electronicTransaction?.content && (
        <section>
          <h2 className="mb-4 text-lg font-semibold">
            {t("electronicTransaction")}
          </h2>
          <div className="text-muted-foreground whitespace-pre-line text-sm leading-relaxed">
            {electronicTransaction.content}
          </div>
        </section>
      )}
    </div>
  )
}
