import * as React from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Input } from "@/components/ui/input"

interface DataTablePaginationProps
  extends React.HTMLAttributes<HTMLDivElement> {
  count: number
  pageSize: number
  pageIndex: number
  pageCount: number
  canPreviousPage: boolean
  canNextPage: boolean
  previousPage: () => void
  nextPage: () => void
  goPage: (page: number) => void
}

export function DataTablePagination({
  className,
  count,
  pageSize,
  pageIndex,
  pageCount,
  canPreviousPage,
  canNextPage,
  previousPage,
  nextPage,
  goPage,
  ...props
}: DataTablePaginationProps) {
  const from = count === 0 ? 0 : pageIndex * pageSize + 1
  const to = Math.min(count, (pageIndex + 1) * pageSize)

  return (
    <div
      className={cn(
        "flex w-full items-center justify-between px-2 py-2",
        className,
      )}
      {...props}
    >
      <div>
        <p className="text-xs">{`${count} 중 ${from} - ${to}`}</p>
      </div>
      <div className="flex items-center gap-1">
        <GoToPagePopover
          pageCount={pageCount}
          pageIndex={pageIndex}
          goPage={goPage}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={previousPage}
          disabled={!canPreviousPage}
        >
          이전
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={nextPage}
          disabled={!canNextPage}
        >
          다음
        </Button>
      </div>
    </div>
  )
}

function GoToPagePopover({
  pageCount,
  pageIndex,
  goPage,
}: {
  pageCount: number
  pageIndex: number
  goPage: (page: number) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [value, setValue] = React.useState("")

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const page = parseInt(value, 10)
    if (!isNaN(page) && page >= 1 && page <= pageCount) {
      goPage(page - 1)
      setOpen(false)
      setValue("")
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm">
          {`${pageIndex + 1} / ${pageCount}`}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48">
        <form onSubmit={handleSubmit} className="grid gap-3">
          <h4 className="text-sm font-medium leading-none">페이지로 이동</h4>
          <Input
            type="number"
            autoFocus
            min={1}
            max={pageCount}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={`1 - ${pageCount}`}
            className="h-8"
          />
          <Button type="submit" size="sm">
            이동
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}
