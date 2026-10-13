"use client"

import { useEffect, useState, useTransition } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { Button } from "@/components/ui/button"
import {
  deleteMyAlmondSavedDesign,
  listMyAlmondSavedDesigns,
} from "@/lib/api/ugc/almond-saved-designs"
import type { AlmondSavedDesignSummary } from "@/lib/types/ui/almond-template"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import { isUnauthorized } from "../hooks/use-auth-retry"
import { PRINT_PRODUCTS, PRINT_SPECS } from "../lib/catalog"
import { SavedThumbnail } from "./saved-thumbnail"

export function MyAlmondDesigns() {
  const t = useTranslations("mypage.almondTemplates")
  const [items, setItems] = useState<AlmondSavedDesignSummary[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    startTransition(async () => {
      try {
        setItems(await listMyAlmondSavedDesigns("", ""))
      } catch (error) {
        if (isUnauthorized(error)) throw error
        setFailed(true)
      }
    })
  }, [])

  const remove = (item: AlmondSavedDesignSummary) => {
    if (!window.confirm(t("deleteConfirm", { title: item.title }))) return
    startTransition(async () => {
      try {
        await deleteMyAlmondSavedDesign(item.id)
        setItems(
          (current) => current?.filter((saved) => saved.id !== item.id) ?? null
        )
        toast.success(t("deleted"))
      } catch (error) {
        if (isUnauthorized(error)) throw error
        toast.error(t("deleteFail"))
      }
    })
  }

  if (failed)
    return <p className="text-muted-foreground mt-8 text-sm">{t("loadFail")}</p>
  if (!items)
    return (
      <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {[0, 1].map((key) => (
          <div key={key} className="bg-muted h-28 animate-pulse rounded-xl" />
        ))}
      </div>
    )
  if (!items.length)
    return (
      <div className="border-border mt-8 rounded-2xl border px-6 py-12 text-center">
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
        <Button asChild variant="outline" className="mt-4">
          <LocalizedClientLink href="/almond-template">
            {t("browse")}
          </LocalizedClientLink>
        </Button>
      </div>
    )

  return (
    <ul className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
      {items.map((item) => {
        const product = PRINT_PRODUCTS[item.productId]
        return (
          <li
            key={item.id}
            className="border-border flex gap-4 rounded-xl border p-4"
          >
            <SavedThumbnail
              id={item.id}
              version={item.updatedAt}
              className="h-24 w-28 rounded-lg"
            />
            <div className="flex min-w-0 flex-1 flex-col">
              <strong className="text-foreground truncate text-sm">
                {item.title}
              </strong>
              <span className="text-muted-foreground mt-1 truncate text-xs">
                {product?.title ??
                  (product ? PRINT_SPECS[product.kind].label : "")}{" "}
                · {item.size.replace("x", "×")}mm
              </span>
              <span className="text-muted-foreground text-xs">
                {t("savedAt")}{" "}
                {formatDate(item.updatedAt, DATE_FORMATS.KO_DOT_TIME)}
              </span>
              <div className="mt-auto flex gap-2 pt-2">
                <Button asChild size="sm">
                  <LocalizedClientLink
                    href={`/almond-template/edit?product=${item.productId}&size=${item.size}&saved=${item.id}`}
                  >
                    {t("edit")}
                  </LocalizedClientLink>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => remove(item)}
                >
                  {t("delete")}
                </Button>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
