import { useEffect, useRef, useState, type InputHTMLAttributes } from "react"
import { useLeaveWarning } from "../../hooks/use-leave-warning"

type Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type"
> & {
  // 여러 요소의 값이 서로 다르면 null 로 비워 두고, 입력하면 모두에 같은 값이 들어간다
  value: number | null
  onValue: (value: number) => void
}

type Pending = { raw: string; from: number; apply: (value: number) => void }

export function NumberInput({
  value,
  onValue,
  onBlur,
  onKeyDown,
  ...rest
}: Props) {
  const [draft, setDraft] = useState<string | null>(null)
  const pending = useRef<Pending | null>(null)
  useLeaveWarning(draft !== null && Number(draft) !== value)
  const clamp = (raw: string) =>
    Math.min(
      Number(rest.max ?? Infinity),
      Math.max(Number(rest.min ?? -Infinity), Number(raw))
    )
  const commit = ({ raw, from, apply }: Pending) => {
    pending.current = null
    setDraft(null)
    const next = clamp(raw)
    if (raw.trim() !== "" && Number.isFinite(next) && next !== from) apply(next)
  }
  // 캔버스에서 다른 레이어를 누르면 blur 전에 이 입력이 사라지므로, 남은 입력은 사라질 때 원래 레이어에 반영한다
  const flush = useRef(commit)
  flush.current = commit
  useEffect(
    () => () => {
      if (pending.current) flush.current(pending.current)
    },
    []
  )
  return (
    <input
      {...rest}
      type="number"
      value={draft ?? value ?? ""}
      onChange={(event) => {
        const typed = (event.nativeEvent as InputEvent).inputType
        const raw = event.target.value
        const from = value ?? NaN
        if (!typed) return commit({ raw, from, apply: onValue })
        pending.current = pending.current
          ? { ...pending.current, raw }
          : { raw, from, apply: onValue }
        setDraft(raw)
      }}
      onBlur={(event) => {
        if (pending.current) commit(pending.current)
        onBlur?.(event)
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur()
        else if (event.key === "Escape") {
          event.stopPropagation()
          pending.current = null
          setDraft(null)
        }
        onKeyDown?.(event)
      }}
    />
  )
}
