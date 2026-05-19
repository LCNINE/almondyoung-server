import { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import { Button } from "@/components/ui/button"
import { ShoppingCart } from "lucide-react"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("cart.notFound")
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
  }
}

export default async function NotFound() {
  const t = await getTranslations("cart.notFound")

  return (
    <div className="flex min-h-[calc(100vh-64px)] flex-col items-center justify-center gap-6 px-4">
      <div className="bg-muted flex h-20 w-20 items-center justify-center rounded-full">
        <ShoppingCart className="text-muted-foreground h-10 w-10" />
      </div>
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-foreground text-2xl font-semibold">
          {t("title")}
        </h1>
        <p className="text-muted-foreground text-sm">
          {t("description")}
        </p>
      </div>
      <Button asChild>
        <LocalizedClientLink href="/">{t("backHome")}</LocalizedClientLink>
      </Button>
    </div>
  )
}
