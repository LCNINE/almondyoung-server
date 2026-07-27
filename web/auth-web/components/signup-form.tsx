"use client"

import Link from "next/link"
import { useState, useTransition } from "react"

import { signUpAction } from "@/app/actions"
import { AccountStep } from "@/components/signup/account-step"
import { AgreementsStep } from "@/components/signup/agreements-step"
import { ProfileStep } from "@/components/signup/profile-step"
import type { StepValues } from "@/components/signup/types"
import { Button } from "@/components/ui/button"

const STEPS = ["약관 동의", "계정 정보", "회원 정보"] as const

export function SignUpForm({ redirectTo }: { redirectTo: string }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState(0)
  const [values, setValues] = useState<StepValues>({})

  const advance = (stepValues: StepValues) => {
    setValues((prev) => ({ ...prev, ...stepValues }))
    setError(null)
    setStep((s) => s + 1)
  }

  const back = () => {
    setError(null)
    setStep((s) => s - 1)
  }

  const submit = (stepValues: StepValues) => {
    const merged = { ...values, ...stepValues, redirectTo }
    setValues(merged)
    setError(null)
    startTransition(async () => {
      const fd = new FormData()
      // 체크박스는 각 스텝에서 이미 "on" | "" 로 정규화돼 들어온다.
      for (const [key, value] of Object.entries(merged)) fd.set(key, value)
      const res = await signUpAction(fd)
      if (res && !res.ok) setError(res.error)
    })
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <Stepper current={step} />

      {step === 0 && <AgreementsStep defaultValues={values} onNext={advance} />}
      {step === 1 && (
        <AccountStep defaultValues={values} onNext={advance} onBack={back} />
      )}
      {step === 2 && (
        <ProfileStep
          defaultValues={values}
          onSubmit={submit}
          onBack={back}
          pending={pending}
        />
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Button asChild className="h-13">
        <Link
          href={`/?${redirectTo ? new URLSearchParams({ redirect_to: redirectTo }).toString() : ""}`}
        >
          계정 리스트로 돌아가기
        </Link>
      </Button>
    </div>
  )
}

function Stepper({ current }: { current: number }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1.5" aria-hidden>
        {STEPS.map((label, i) => (
          <span
            key={label}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i <= current ? "bg-primary" : "bg-secondary"
            }`}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {current + 1}/{STEPS.length} · {STEPS[current]}
      </p>
    </div>
  )
}
