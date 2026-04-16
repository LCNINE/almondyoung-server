import { format } from "date-fns"
import { ko } from "date-fns/locale"

export function DateCell({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-muted-foreground">-</span>

  return (
    <span className="text-xs">
      {format(new Date(value), "yyyy.MM.dd HH:mm", { locale: ko })}
    </span>
  )
}
