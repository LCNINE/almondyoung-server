import { useMemo, useState } from "react"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useSkus } from "@/lib/services/inventory/skus"

type Props = {
  value?: string
  onChange: (value: string) => void
  placeholder?: string
  selectedLabel?: string
}

export function SkuSearchSelect({
  value,
  onChange,
  placeholder = "SKU 선택",
  selectedLabel,
}: Props) {
  const [search, setSearch] = useState("")
  const { data, isFetching } = useSkus({
    search: search || undefined,
    limit: 20,
    offset: 0,
  })

  const options = useMemo(() => {
    const base = (data?.items ?? []).map((sku) => ({
      value: sku.id,
      label: `${sku.name}${sku.code ? ` (${sku.code})` : ""}`,
    }))

    if (value && !base.some((option) => option.value === value)) {
      base.unshift({
        value,
        label: selectedLabel || value,
      })
    }

    return base
  }, [data?.items, selectedLabel, value])

  const activeLabel =
    options.find((option) => option.value === value)?.label ?? selectedLabel

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8"
          placeholder="SKU 검색"
        />
      </div>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {activeLabel && (
        <p className="text-xs text-muted-foreground">
          선택됨: {activeLabel}
          {isFetching ? " · 검색 중" : ""}
        </p>
      )}
    </div>
  )
}
