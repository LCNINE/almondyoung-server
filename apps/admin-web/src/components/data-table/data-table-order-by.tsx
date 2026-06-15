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
  /**
   * preset 모드: 각 옵션이 이미 정렬 방향을 포함한 단일 키(latest/oldest 등).
   * asc/desc 토글 비활성, `order` 파라미터 미사용.
   */
  presetOnly?: boolean
}

export function DataTableOrderBy({ orderBy, prefix, presetOnly }: DataTableOrderByProps) {
  const { get, add, addMany, deleteMany } = useSelectedParams({ prefix })

  const rawSort = get('sort')
  const rawOrder = get('order')
  const sortValue = Array.isArray(rawSort) ? rawSort[0] : rawSort
  const orderValue = (Array.isArray(rawOrder) ? rawOrder[0] : rawOrder) ?? 'asc'

  const currentLabel = orderBy.find((o) => o.key === sortValue)?.label

  const handleSelect = (key: string) => {
    if (presetOnly) {
      add('sort', key)
      return
    }
    if (sortValue === key) {
      add('order', orderValue === 'asc' ? 'desc' : 'asc')
    } else {
      addMany({ sort: key, order: 'asc' })
    }
  }

  const handleClear = () => {
    deleteMany(presetOnly ? ['sort'] : ['sort', 'order'])
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1 text-xs">
          <ArrowUpDown className="h-3.5 w-3.5" />
          {currentLabel ? (
            <>
              {currentLabel}
              {!presetOnly && (
                <span className="text-muted-foreground">
                  {orderValue === 'asc' ? '↑' : '↓'}
                </span>
              )}
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
            {sortValue === opt.key && !presetOnly && (
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
