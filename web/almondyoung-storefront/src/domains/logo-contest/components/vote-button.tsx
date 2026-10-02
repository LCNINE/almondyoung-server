"use client"

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
import { Button } from "@/components/ui/button"
import {
  unvoteLogoContestEntry,
  voteLogoContestEntry,
} from "@/lib/api/ugc/logo-contest"
import { logoContestVoteOff, logoContestVoteOn } from "../banner-assets"
import { siteConfig } from "@/lib/config/site"
import { getPathWithoutCountry } from "@/lib/utils/get-path-without-country"
import { cn } from "@/lib/utils"
import { useUser } from "@/contexts/user-context"
import { useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { ThumbsUp } from "lucide-react"
import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import { showContestToast } from "./contest-toast"

interface VoteButtonProps {
  countryCode: string
  entryId: string
  isOwnEntry: boolean
  votedEntryId: string | null
  voteCount: number
  canVote: boolean
  upcomingNotice?: string
  variant?: "full" | "tile"
}

export function VoteButton({
  countryCode,
  entryId,
  isOwnEntry,
  votedEntryId,
  voteCount,
  canVote,
  upcomingNotice,
  variant = "full",
}: VoteButtonProps) {
  const t = useTranslations("logoContest.vote")
  const tContest = useTranslations("logoContest")
  const router = useRouter()
  const { user } = useUser()
  const [open, setOpen] = useState(false)
  const [votedId, setVotedId] = useState(votedEntryId)
  const [count, setCount] = useState(voteCount)
  const [isPending, startTransition] = useTransition()

  useEffect(() => setVotedId(votedEntryId), [votedEntryId])
  useEffect(() => setCount(voteCount), [voteCount])
  useEffect(() => {
    if (process.env.NODE_ENV !== "development" || canVote) return
    const syncPreview = (event: Event) => {
      const selectedId = (event as CustomEvent<string | null>).detail
      setVotedId(selectedId)
      setCount(voteCount + Number(selectedId === entryId))
    }
    window.addEventListener("logo-contest-preview-vote", syncPreview)
    return () =>
      window.removeEventListener("logo-contest-preview-vote", syncPreview)
  }, [canVote, entryId, voteCount])
  const disabledReason = isOwnEntry
    ? t("own")
    : votedId
      ? votedId === entryId
        ? t("voted")
        : t("switchConfirm")
      : null
  const switching = !!votedId && votedId !== entryId

  const goToLogin = () => {
    const path = getPathWithoutCountry(countryCode)
    router.push(
      `/${countryCode}${siteConfig.auth.loginUrl}?redirect_to=${encodeURIComponent(path)}`
    )
  }

  const handleClick = () => {
    if (isOwnEntry) {
      showContestToast(t("own"))
      return
    }
    if (!canVote) {
      if (process.env.NODE_ENV !== "development") {
        showContestToast(upcomingNotice ?? "")
        return
      }
      if (switching) {
        setOpen(true)
        return
      }
      const removing = votedId === entryId
      window.dispatchEvent(
        new CustomEvent("logo-contest-preview-vote", {
          detail: removing ? null : entryId,
        })
      )
      showContestToast(removing ? t("undone") : t("done"), t("previewOnly"))
      return
    }
    if (!user) {
      if (window.confirm(t("loginRequired"))) goToLogin()
      return
    }
    if (votedId === entryId) {
      startTransition(async () => {
        try {
          const result = await unvoteLogoContestEntry(entryId)
          if (!result.ok) {
            toast.error(result.message)
            return
          }
          setVotedId(null)
          setCount(result.data.voteCount)
          showContestToast(t("undone"))
          router.refresh()
        } catch {
          toast.error(t("undoFail"))
        }
      })
      return
    }
    setOpen(true)
  }

  const handleConfirm = () => {
    setOpen(false)
    if (!canVote && process.env.NODE_ENV === "development") {
      window.dispatchEvent(
        new CustomEvent("logo-contest-preview-vote", { detail: entryId })
      )
      showContestToast(switching ? t("switched") : t("done"), t("previewOnly"))
      return
    }
    startTransition(async () => {
      try {
        const result = await voteLogoContestEntry(entryId)
        if (!result.ok) {
          toast.error(
            result.reason === "conflict" ? t("already") : result.message
          )
          if (result.reason === "conflict") router.refresh()
          return
        }
        setVotedId(entryId)
        setCount(result.data.voteCount)
        showContestToast(switching ? t("switched") : t("done"))
        router.refresh()
      } catch (error: unknown) {
        const err = error as Error & { digest?: string }
        if (err.digest === "UNAUTHORIZED" || err.message === "UNAUTHORIZED") {
          throw error
        }
        toast.error(t("fail"))
      }
    })
  }

  return (
    <>
      <Button
        type="button"
        variant={variant === "full" ? "outline" : "default"}
        onClick={handleClick}
        disabled={isPending}
        aria-label={
          variant === "tile"
            ? `${disabledReason ?? t("action")} (${count})`
            : undefined
        }
        title={variant === "tile" ? (disabledReason ?? undefined) : undefined}
        className={cn(
          variant === "tile"
            ? "h-9 min-w-14 gap-0.5 rounded-md bg-transparent px-1 text-xs font-bold text-[#24343d] shadow-none transition-transform hover:bg-black/5 active:scale-90 disabled:opacity-100 lg:h-10 lg:text-white lg:hover:bg-white/10"
            : "border-border text-foreground hover:border-primary/60 hover:bg-transparent hover:text-primary h-10 gap-2 rounded-lg px-3.5 text-sm font-medium shadow-none",
          variant === "full" && votedId === entryId && "border-primary/60 text-primary"
        )}
      >
        {variant === "tile" ? (
          <Image
            key={votedId === entryId ? "on" : "off"}
            src={votedId === entryId ? logoContestVoteOn : logoContestVoteOff}
            alt=""
            width={32}
            height={32}
            unoptimized
            className="motion-safe:animate-[clay-vote-pop_420ms_ease-out]"
          />
        ) : (
          <ThumbsUp className="size-4" aria-hidden="true" />
        )}
        {variant === "tile" ? (
          count
        ) : (
          <>
            <span>{isOwnEntry ? t("action") : disabledReason ?? t("action")}</span>
            <span className="text-muted-foreground text-xs tabular-nums">
              {tContest("voteCount", { count })}
            </span>
          </>
        )}
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(switching ? "switchTitle" : "confirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(switching ? "switchDescription" : "confirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>
              {t(switching ? "switchConfirm" : "confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
