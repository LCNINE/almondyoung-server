import { useEffect, useRef, useState } from "react"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { useSelectedParams } from "@/hooks/use-selected-params"

type DataTableSearchProps = {
  prefix?: string
  placeholder?: string
}

export function DataTableSearch({
  prefix,
  placeholder = "검색...",
}: DataTableSearchProps) {
  const { get, add, delete: del } = useSelectedParams({ prefix })
  const raw = get("q")
  const currentValue = Array.isArray(raw) ? raw[0] : (raw ?? "")

  const [value, setValue] = useState(currentValue)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setValue(currentValue)
  }, [currentValue])

  const handleChange = (val: string) => {
    setValue(val)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      if (val) add("q", val)
      else del("q")
    }, 500)
  }

  return (
    <div className="relative">
      <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        className="h-8 pl-8 text-sm"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  )
}
