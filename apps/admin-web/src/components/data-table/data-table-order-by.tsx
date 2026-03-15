'use client'

import { ArrowUpDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useSelectedParams } from '@/hooks/table/use-selected-params'

type OrderByOption = {
  key: string
  label: string
}

type DataTableOrderByProps = {
  orderBy: OrderByOption[]
  prefix?: string
}

export function DataTableOrderBy({ orderBy, prefix }: DataTableOrderByProps) {
  const { get, add, deleteMany } = useSelectedParams({ prefix })

  const rawSort = get('sort')
  const rawOrder = get('order')
  const sortValue = Array.isArray(rawSort) ? rawSort[0] : rawSort
  const orderValue = (Array.isArray(rawOrder) ? rawOrder[0] : rawOrder) ?? 'asc'

  const currentLabel = orderBy.find((o) => o.key === sortValue)?.label

  const handleSelect = (key: string) => {
    if (sortValue === key) {
      add('order', orderValue === 'asc' ? 'desc' : 'asc')
    } else {
      add('sort', key)
      add('order', 'asc')
    }
  }

  const handleClear = () => {
    deleteMany(['sort', 'order'])
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1 text-xs">
          <ArrowUpDown className="h-3.5 w-3.5" />
          {currentLabel ? (
            <>
              {currentLabel}
              <span className="text-muted-foreground">{orderValue === 'asc' ? '↑' : '↓'}</span>
            </>
          ) : (
            '정렬'
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {orderBy.map((opt) => (
          <DropdownMenuItem
            key={opt.key}
            onSelect={() => handleSelect(opt.key)}
            className={sortValue === opt.key ? 'font-medium' : ''}
          >
            {opt.label}
            {sortValue === opt.key && (
              <span className="ml-auto text-muted-foreground">
                {orderValue === 'asc' ? '↑' : '↓'}
              </span>
            )}
          </DropdownMenuItem>
        ))}
        {sortValue && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleClear} className="text-muted-foreground">
              정렬 초기화
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
