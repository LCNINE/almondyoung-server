import { useState, type InputHTMLAttributes } from "react"
import { useLeaveWarning } from "../../hooks/use-leave-warning"

type Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type"
> & {
  value: number
  onValue: (value: number) => void
}

export function NumberInput({
  value,
  onValue,
  onBlur,
  onKeyDown,
  ...rest
}: Props) {
  const [draft, setDraft] = useState<string | null>(null)
  useLeaveWarning(draft !== null && Number(draft) !== value)
  const commit = (raw: string) => {
    setDraft(null)
    const next = Math.min(
      Number(rest.max ?? Infinity),
      Math.max(Number(rest.min ?? -Infinity), Number(raw))
    )
    if (raw.trim() !== "" && Number.isFinite(next) && next !== value)
      onValue(next)
  }
  return (
    <input
      {...rest}
      type="number"
      value={draft ?? value}
      onChange={(event) => {
        const typed = (event.nativeEvent as InputEvent).inputType
        if (typed) setDraft(event.target.value)
        else commit(event.target.value)
      }}
      onBlur={(event) => {
        if (draft !== null) commit(draft)
        onBlur?.(event)
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur()
        else if (event.key === "Escape") {
          event.stopPropagation()
          setDraft(null)
        }
        onKeyDown?.(event)
      }}
    />
  )
}
