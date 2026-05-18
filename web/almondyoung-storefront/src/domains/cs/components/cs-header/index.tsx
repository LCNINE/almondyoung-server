import { Headphones } from "lucide-react"
import { getTranslations } from "next-intl/server"

export async function CsHeader() {
  const t = await getTranslations("cs.header")
  return (
    <div className="bg-gradient-to-r from-[#f29219] to-[#f5a623] px-4 py-8 text-white">
      <div className="mx-auto max-w-3xl text-center">
        <div className="mb-3 flex items-center justify-center gap-2">
          <Headphones className="h-8 w-8" />
          <h1 className="text-2xl font-bold">{t("title")}</h1>
        </div>
        <p className="text-sm opacity-90">{t("subtitle")}</p>
        <p className="mt-2 text-sm font-medium">{t("hours")}</p>
      </div>
    </div>
  )
}
