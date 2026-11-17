import { Check } from "lucide-react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"

const STEPS = ["design", "proof", "order"] as const

export function OrderSteps({ current }: { current: 1 | 2 }) {
  const t = useTranslations("almondEditor.steps")

  return (
    <ol
      aria-label={t("label")}
      className="flex items-center gap-2 text-[13px] text-slate-600"
    >
      {STEPS.map((step, index) => {
        const number = index + 1
        const done = number < current
        const active = number === current

        return (
          <li key={step} className="flex items-center gap-2">
            {index > 0 && (
              <span aria-hidden="true" className="h-px w-6 bg-[#d9d9d9]" />
            )}
            <span
              aria-current={active ? "step" : undefined}
              className={cn(
                "flex items-center gap-1.5",
                active && "font-bold text-slate-900"
              )}
            >
              <span
                className={cn(
                  "flex h-[22px] w-[22px] items-center justify-center rounded-full border text-xs",
                  active && "border-slate-900 bg-slate-900 text-white",
                  done && "border-slate-200 bg-slate-200",
                  !active && !done && "border-slate-400"
                )}
              >
                {done ? <Check size={12} strokeWidth={3} /> : number}
              </span>
              {t(step)}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
