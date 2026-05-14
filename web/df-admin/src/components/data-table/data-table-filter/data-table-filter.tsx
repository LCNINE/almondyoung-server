import { useState } from "react"
import { ListFilter } from "lucide-react"
import { useLocation, useNavigate, useSearchParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { FilterProvider } from "./context"
import { SelectFilter } from "./select-filter"
import { StringFilter } from "./string-filter"
import type { Filter } from "./types"

type DataTableFilterProps = {
  filters: Filter[]
  prefix?: string
}

export function DataTableFilter({ filters, prefix }: DataTableFilterProps) {
  const [openFilter, setOpenFilter] = useState<string | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()

  const prefixKey = (key: string) => (prefix ? `${prefix}_${key}` : key)

  const removeFilter = (key: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.delete(prefixKey(key))
    params.delete(prefixKey("page"))
    const qs = params.toString()
    navigate(`${location.pathname}${qs ? `?${qs}` : ""}`, { replace: true })
  }

  const removeAllFilters = () => {
    const params = new URLSearchParams(searchParams.toString())
    for (const filter of filters) {
      params.delete(prefixKey(filter.key))
    }
    params.delete(prefixKey("page"))
    const qs = params.toString()
    navigate(`${location.pathname}${qs ? `?${qs}` : ""}`, { replace: true })
  }

  const hasActiveFilters = filters.some((f) => searchParams.has(prefixKey(f.key)))

  const handleOpenChange = (key: string) => (open: boolean) => {
    setOpenFilter(open ? key : null)
  }

  return (
    <FilterProvider
      prefix={prefix}
      removeFilter={removeFilter}
      removeAllFilters={(keys) => keys.forEach(removeFilter)}
    >
      <div className="flex flex-wrap items-center gap-2">
        {filters.map((filter) => {
          const isOpen = openFilter === filter.key
          const onOpenChange = handleOpenChange(filter.key)

          if (filter.type === "select") {
            return (
              <SelectFilter
                key={filter.key}
                filter={filter}
                open={isOpen}
                onOpenChange={onOpenChange}
                prefix={prefix}
              />
            )
          }
          if (filter.type === "string") {
            return (
              <StringFilter
                key={filter.key}
                filter={filter}
                open={isOpen}
                onOpenChange={onOpenChange}
                prefix={prefix}
              />
            )
          }
          return null
        })}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1 text-xs h-7">
              <ListFilter className="h-3.5 w-3.5" />
              필터 추가
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {filters.map((filter) => (
              <DropdownMenuItem
                key={filter.key}
                onSelect={() =>
                  setTimeout(() => setOpenFilter(filter.key), 0)
                }
              >
                {filter.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7 text-muted-foreground"
            onClick={removeAllFilters}
          >
            모두 지우기
          </Button>
        )}
      </div>
    </FilterProvider>
  )
}
