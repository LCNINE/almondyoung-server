"use client"

import { useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CardThumbnail } from "@/domains/shop-trade/components/listing-card/card-thumbnail"
import { myListingActions } from "@/domains/shop-trade/my-listing-status"
import {
  closeMyShopListing,
  deleteMyShopListing,
  reopenMyShopListing,
} from "@/lib/api/ugc/my-shop-listings"
import type { MyShopListingItem } from "@/lib/types/ui/shop-listing"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"

export function MyListings({ items }: { items: MyShopListingItem[] }) {
  const t = useTranslations("shopTrade.mine")
  const router = useRouter()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<MyShopListingItem | null>(null)
  const [, startTransition] = useTransition()

  const run = (
    id: string,
    action: () => Promise<{ ok: boolean; status?: number; message?: string }>,
    doneKey: "closedDone" | "reopenedDone" | "deletedDone"
  ) => {
    setPendingId(id)
    startTransition(async () => {
      const result = await action()
      setPendingId(null)
      if (result.ok) {
        toast.success(t(doneKey))
        router.refresh()
      } else if (result.status === 401) {
        // 루트 error.tsx 가 토큰을 복구한다 — CLAUDE.md §6
        throw new Error("UNAUTHORIZED")
      } else {
        // 한도 초과 같은 409 는 서버 문구가 더 정확하다
        toast.error(result.message || t("actionFail"))
      }
    })
  }

  if (items.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
        <Button asChild className="mt-4 h-[52px] rounded-xl px-6 text-base font-bold">
          <LocalizedClientLink href="/mypage/shop-listings/new">
            {t("register")}
          </LocalizedClientLink>
        </Button>
      </div>
    )
  }

  return (
    <>
      <ul className="divide-border divide-y border-y">
        {items.map((item) => {
          const actions = myListingActions(item.status)
          const busy = pendingId === item.id

          return (
            <li key={item.id} className="flex gap-4 py-4">
              <div className="bg-muted relative aspect-[4/3] w-24 shrink-0 overflow-hidden rounded-lg sm:w-32">
                <CardThumbnail
                  images={item.imageFileIds}
                  fallbackFileId={item.thumbnailFileId}
                  alt={item.title}
                  sizes="128px"
                  enableHover={false}
                  enableSwipe={false}
                />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="shrink-0">
                    {t(`status.${item.status}`)}
                  </Badge>
                  <p className="text-foreground line-clamp-1 text-sm font-medium">
                    {item.title}
                  </p>
                </div>

                {item.status === "rejected" && item.rejectReason && (
                  <p className="text-muted-foreground mt-1 text-xs">
                    {t("rejectReason", { reason: item.rejectReason })}
                  </p>
                )}
                {item.status === "hidden" && (
                  <p className="text-muted-foreground mt-1 text-xs">
                    {t("hiddenNotice")}
                  </p>
                )}

                <p className="text-muted-foreground mt-1 text-xs">
                  {formatDate(item.createdAt, DATE_FORMATS.KO_DOT)}
                </p>

                <div className="mt-2 flex flex-wrap gap-2">
                  {actions.includes("edit") && (
                    <Button variant="outline" size="sm" asChild disabled={busy}>
                      <LocalizedClientLink href={`/mypage/shop-listings/${item.id}/edit`}>
                        {t("edit")}
                      </LocalizedClientLink>
                    </Button>
                  )}
                  {actions.includes("close") && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        run(item.id, () => closeMyShopListing(item.id), "closedDone")
                      }
                    >
                      {t("close")}
                    </Button>
                  )}
                  {actions.includes("reopen") && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        run(item.id, () => reopenMyShopListing(item.id), "reopenedDone")
                      }
                    >
                      {t("reopen")}
                    </Button>
                  )}
                  {actions.includes("delete") && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => setDeleteTarget(item)}
                    >
                      {t("delete")}
                    </Button>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("deleteBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = deleteTarget
                setDeleteTarget(null)
                if (target)
                  run(target.id, () => deleteMyShopListing(target.id), "deletedDone")
              }}
            >
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
