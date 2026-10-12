"use client"

import { useUser } from "@/contexts/user-context"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  getGrowthNotes,
  recordGrowthNote,
  removeGrowthNote,
} from "@/lib/api/users/beautytop-growth"
import {
  GROWTH_ACTIONS,
  isGrowthAction,
  type GrowthAction,
  type GrowthNote,
  type GrowthNotesResult,
} from "@/lib/types/ui/beautytop-growth"
import { formatDate, DATE_FORMATS } from "@/lib/utils/format-date"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { useState, useTransition, useEffect, useRef } from "react"
import { useMyShop } from "../use-watchlist"
import { CardSkeleton, LoadError } from "../components/parts"

export function GrowthNotes({
  suggestedAction = null,
}: {
  suggestedAction?: GrowthAction | null
}) {
  const [shop] = useMyShop()
  const { user } = useUser()
  return shop && user ? (
    <ShopGrowthNotes
      key={`${user.id}:${shop.kind}:${shop.id}`}
      userId={user.id}
      shopKind={shop.kind}
      shopId={shop.id}
      suggestedAction={suggestedAction}
    />
  ) : null
}

function ShopGrowthNotes({
  userId,
  shopKind,
  shopId,
  suggestedAction,
}: {
  userId: string
  shopKind: "SHOP" | "PERSON"
  shopId: number
  suggestedAction: GrowthAction | null
}) {
  const t = useTranslations("beautytop.growthNotes")
  const client = useQueryClient()
  const queryKey = ["beautytop-growth-notes", userId, shopKind, shopId]
  const target = { shopKind, shopId }
  const notes = useQuery<GrowthNote[]>({
    queryKey,
    queryFn: () => getGrowthNotes(target),
    staleTime: 60_000,
    retry: false,
  })
  const [picked, setPicked] = useState<GrowthAction>(
    suggestedAction ?? "MENU_CLARITY"
  )
  const [memo, setMemo] = useState("")
  const [pending, startTransition] = useTransition()
  const [status, setStatus] = useState<
    "saved" | "removed" | "FAILED" | "SHOP_CHANGED" | null
  >(null)

  const mutate = (
    task: () => Promise<GrowthNotesResult>,
    success: "saved" | "removed"
  ) => {
    setStatus(null)
    startTransition(async () => {
      const result = await task()
      if (result.ok) {
        client.setQueryData(queryKey, result.data)
        setStatus(success)
        if (success === "saved") setMemo("")
      } else setStatus(result.code)
    })
  }

  const section = useRef<HTMLElement>(null)
  useEffect(() => {
    if (suggestedAction && !notes.isPending && !notes.isError) {
      section.current?.scrollIntoView({ block: "start" })
      section.current?.focus({ preventScroll: true })
    }
  }, [suggestedAction, notes.isPending, notes.isError])

  if (notes.isPending) return <CardSkeleton />
  if (notes.isError) return <LoadError onRetry={() => notes.refetch()} />

  return (
    <section
      ref={section}
      tabIndex={-1}
      aria-labelledby="bt-growth-notes"
      className="bg-background border-border focus-visible:ring-ring flex scroll-mt-24 flex-col gap-4 rounded-xl border p-4 focus-visible:ring-2"
    >
      <h2 id="bt-growth-notes" className="text-xl font-bold">
        {t("title")}
      </h2>
      <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
      {suggestedAction && (
        <p role="status" className="bg-muted rounded-lg p-3 text-sm">
          {t("suggested")}
        </p>
      )}
      <fieldset disabled={pending} className="flex flex-col gap-2">
        <legend className="mb-3 text-sm font-medium">
          {t("actionPrompt")}
        </legend>
        {GROWTH_ACTIONS.map((action) => (
          <label
            key={action}
            className="bg-muted flex min-h-12 items-center gap-3 rounded-lg p-3 text-sm"
          >
            <input
              type="radio"
              name="bt-growth-action"
              value={action}
              checked={picked === action}
              onChange={() => setPicked(action)}
              className="size-4"
            />
            {t(`actions.${action}`)}
          </label>
        ))}
      </fieldset>
      <label
        htmlFor="bt-growth-memo"
        className="flex flex-col gap-2 text-sm font-medium"
      >
        {t("memo")}
        <Textarea
          id="bt-growth-memo"
          value={memo}
          onChange={(event) => setMemo(event.target.value)}
          maxLength={240}
          disabled={pending}
          className="text-base"
        />
      </label>
      <Button
        disabled={pending}
        onClick={() =>
          mutate(
            () => recordGrowthNote({ ...target, action: picked, memo }),
            "saved"
          )
        }
        className="h-[52px] rounded-xl"
      >
        {t(pending ? "saving" : "save")}
      </Button>
      <p className="text-muted-foreground text-xs">{t("dailyLimit")}</p>
      {status && (
        <p
          role={
            status === "FAILED" || status === "SHOP_CHANGED"
              ? "alert"
              : "status"
          }
          className="text-sm"
        >
          {t(`status.${status}`)}
        </p>
      )}
      <div className="border-border border-t pt-4">
        <h3 className="text-base font-medium">{t("history")}</h3>
        {notes.data.length === 0 ? (
          <p className="text-muted-foreground mt-3 text-sm">{t("empty")}</p>
        ) : (
          <ol className="divide-border mt-3 divide-y">
            {notes.data.map((note) => (
              <li
                key={note.id}
                className="flex items-start justify-between gap-3 py-4"
              >
                <div className="min-w-0">
                  <p className="text-muted-foreground text-xs">
                    {formatDate(note.createdAt, DATE_FORMATS.KO_DOT_TIME)}
                  </p>
                  <p className="mt-1 text-sm font-medium">
                    {isGrowthAction(note.action)
                      ? t(`actions.${note.action}`)
                      : t("genericAction")}
                  </p>
                  {note.memo && (
                    <p className="text-muted-foreground mt-2 text-sm break-words whitespace-pre-wrap">
                      {note.memo}
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  aria-label={t("removeLabel", {
                    date: formatDate(note.createdAt, DATE_FORMATS.ISO_DATE),
                  })}
                  onClick={() =>
                    mutate(() => removeGrowthNote(target, note.id), "removed")
                  }
                >
                  {t("remove")}
                </Button>
              </li>
            ))}
          </ol>
        )}
      </div>
      <p className="text-muted-foreground text-xs leading-5">{t("note")}</p>
    </section>
  )
}
