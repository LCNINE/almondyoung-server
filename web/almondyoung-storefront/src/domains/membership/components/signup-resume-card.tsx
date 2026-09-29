"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { getSignupResumeTarget } from "@lib/api/membership/signup-resume"
import type { SignupResumeTarget } from "@lib/utils/signup-resume"

/**
 * 자동이체 계좌만 등록하고 멤버십 가입은 마치지 못한 고객에게 가입을 이어 가는 길을 보인다.
 *
 * 가입은 계좌 등록 화면을 다녀와야 끝나서, 중간에 떠나면 계좌는 은행 심사 중인데 가입은 없는 상태가
 * 남는다. 그 고객이 멤버십 화면이나 결제수단 화면에 다시 왔을 때 여기서 받는다.
 * 가입 화면은 등록된 계좌를 스스로 골라 두므로 링크만 건다(플랜 선택·약관 동의는 거기서 한다).
 *
 * 판정을 못 하면(조회 실패) 아무것도 그리지 않는다. 대부분의 고객에게는 빈자리도 남기지 않는다.
 */
export default function SignupResumeCard({
  className,
}: {
  className?: string
}) {
  const t = useTranslations("mypage.membership.signupResume")
  const [target, setTarget] = useState<SignupResumeTarget | null>(null)

  useEffect(() => {
    let active = true
    getSignupResumeTarget()
      .then((r) => {
        if (active && r.kind === "resume") setTarget(r)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  if (!target || target.kind !== "resume") return null

  const account = target.displayName ?? t("accountFallback")

  return (
    <section
      data-testid="signup-resume-card"
      className={`border-primary/40 w-full rounded-xl border bg-white p-4 ${className ?? ""}`}
    >
      <h3 className="text-foreground text-sm font-bold">{t("title")}</h3>
      <p className="text-muted-foreground mt-1 text-xs leading-5 break-keep">
        {target.pendingMandate
          ? t("descPending", { account })
          : t("descApproved", { account })}
      </p>
      <p className="text-muted-foreground mt-1 text-xs leading-5">
        {t("note")}
      </p>
      <LocalizedClientLink
        href="/mypage/membership/subscribe/payment"
        className="bg-primary hover:bg-primary/90 mt-3 flex h-11 w-full items-center justify-center rounded-lg text-sm font-semibold text-white"
      >
        {t("cta")}
      </LocalizedClientLink>
    </section>
  )
}
