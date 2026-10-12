"use client"

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { acknowledgePremiumUse, BeautyTopError, openPremium } from "@/lib/beautytop/client"
import { useTranslations } from "next-intl"
import { useEffect, useState } from "react"
import { CardSkeleton, LoadError } from "../components/parts"

type GateState =
  | { kind: "checking" }
  | { kind: "open" }
  | { kind: "confirm"; days: number | null; saving: boolean }
  | { kind: "notMember" }
  | { kind: "error" }

// Premium content mounts only after the server recorded the use (or the member agreed to
// lose the 7-day full refund). Nothing premium is fetched while the question is open.
export function PremiumGate({ onDecline, children }: { onDecline: () => void; children: React.ReactNode }) {
  const t = useTranslations("beautytop.confirm")
  const [state, setState] = useState<GateState>({ kind: "checking" })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    openPremium().then(
      () => alive && setState({ kind: "open" }),
      (error: unknown) => {
        if (!alive) return
        if (error instanceof BeautyTopError && error.code === "CONFIRMATION_REQUIRED") {
          setState({ kind: "confirm", days: error.withdrawalDaysRemaining, saving: false })
        } else if (error instanceof BeautyTopError && error.code === "MEMBERSHIP_REQUIRED") {
          setState({ kind: "notMember" })
        } else {
          setState({ kind: "error" })
        }
      }
    )
    return () => { alive = false }
  }, [attempt])

  const agree = async () => {
    setState({ kind: "confirm", days: state.kind === "confirm" ? state.days : null, saving: true })
    try {
      await acknowledgePremiumUse()
      setState({ kind: "open" })
    } catch {
      setState({ kind: "error" })
    }
  }

  if (state.kind === "open") return <>{children}</>
  if (state.kind === "error") return <LoadError onRetry={() => { setState({ kind: "checking" }); setAttempt((n) => n + 1) }} />
  if (state.kind === "notMember") {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <p className="text-[15px] break-keep">{t("lapsed")}</p>
        <LocalizedClientLink href="/mypage/membership" className="bg-primary flex h-12 items-center rounded-xl px-6 font-bold text-white">
          {t("toMembership")}
        </LocalizedClientLink>
      </div>
    )
  }
  return (
    <>
      <CardSkeleton />
      <AlertDialog open={state.kind === "confirm"}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader className="text-left">
            <AlertDialogTitle className="text-xl font-bold">{t("title")}</AlertDialogTitle>
            <AlertDialogDescription className="text-foreground text-[15px] leading-[22px] break-keep">
              {t("body")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {state.kind === "confirm" && state.days !== null && (
            <p className="bg-muted rounded-xl px-4 py-3 text-sm break-keep">{t("daysLeft", { days: state.days })}</p>
          )}
          <LocalizedClientLink href="/mypage/membership" className="text-[13px] text-[#217cf9] underline underline-offset-4">
            {t("policy")}
          </LocalizedClientLink>
          {/* Both choices look the same on purpose: no nudging toward giving up the refund. */}
          <AlertDialogFooter className="grid grid-cols-2 gap-2 sm:space-x-0">
            <button type="button" onClick={onDecline} className="border-border hover:bg-muted h-[52px] rounded-xl border text-base font-bold transition-colors duration-150">
              {t("later")}
            </button>
            <button
              type="button"
              onClick={agree}
              disabled={state.kind === "confirm" && state.saving}
              className="border-border hover:bg-muted h-[52px] rounded-xl border text-base font-bold disabled:opacity-50 transition-colors duration-150"
            >
              {t("open")}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
