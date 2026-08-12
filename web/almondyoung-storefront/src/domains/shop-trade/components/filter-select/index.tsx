"use client"

import { useParams, useRouter } from "next/navigation"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { buildListHref, type ShopTradeListParams } from "../../build-list-href"

const ALL = "__all__"

type Option = { value: string; label: string }

export function FilterSelect({
  params,
  paramKey,
  allLabel,
  options,
  value,
}: {
  params: ShopTradeListParams
  paramKey: keyof ShopTradeListParams
  allLabel: string
  options: Option[]
  value: string | null
}) {
  const router = useRouter()
  const { countryCode } = useParams<{ countryCode: string }>()

  return (
    <Select
      value={value ?? ALL}
      onValueChange={(next) => {
        const href = buildListHref(params, {
          [paramKey]: next === ALL ? null : next,
          page: 1,
        } as Partial<ShopTradeListParams>)
        router.push(`/${countryCode}${href}`)
      }}
    >
      <SelectTrigger
        className={cn(
          "h-9 w-auto shrink-0 gap-1 rounded-full border px-3.5 text-sm",
          value
            ? "border-primary text-primary font-medium [&>svg]:opacity-100"
            : "border-border text-foreground"
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
