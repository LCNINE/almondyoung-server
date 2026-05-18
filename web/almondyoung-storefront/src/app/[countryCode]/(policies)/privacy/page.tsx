import { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { agreements } from "@/lib/data/agreements"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("policies.privacy")
  return { title: t("title") }
}

export default async function PrivacyPage() {
  const t = await getTranslations("policies.privacy")
  const privacyPolicy = agreements.find((a) => a.id === "privacyPolicy")
  const thirdPartySharing = agreements.find(
    (a) => a.id === "thirdPartySharing"
  )

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-8 text-2xl font-bold">{t("title")}</h1>

      {privacyPolicy?.content && (
        <section className="mb-12">
          <h2 className="mb-4 text-lg font-semibold">{t("collection")}</h2>
          <div className="text-muted-foreground whitespace-pre-line text-sm leading-relaxed">
            {privacyPolicy.content}
          </div>
        </section>
      )}

      {thirdPartySharing?.content && (
        <section>
          <h2 className="mb-4 text-lg font-semibold">{t("thirdParty")}</h2>
          <div className="text-muted-foreground whitespace-pre-line text-sm leading-relaxed">
            {thirdPartySharing.content}
          </div>
        </section>
      )}
    </div>
  )
}
