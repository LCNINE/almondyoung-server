import { Badge } from "@/components/ui/badge"

type BadgeCellProps = {
  value: string
  map?: Record<string, { label: string; variant?: "default" | "secondary" | "destructive" | "outline" }>
}

export function BadgeCell({ value, map }: BadgeCellProps) {
  const info = map?.[value]
  return (
    <Badge variant={info?.variant ?? "secondary"} className="text-xs">
      {info?.label ?? value}
    </Badge>
  )
}
