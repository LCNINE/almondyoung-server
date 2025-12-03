import { Button } from "@components/common/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@components/common/ui/dropdown-menu"
import { Filter } from "lucide-react"

interface DownloadFiltersProps {
  currentFilter: "all" | "new" | "used"
  onFilterChange: (filter: "all" | "new" | "used") => void
}

export function DownloadFilters({
  currentFilter,
  onFilterChange,
}: DownloadFiltersProps) {
  const filterLabels: Record<"all" | "new" | "used", string> = {
    all: "전체",
    new: "새로운 상품",
    used: "사용된 상품",
  }

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Filter className="mr-2 h-4 w-4" />
            {filterLabels[currentFilter]}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel>필터</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup
            value={currentFilter}
            onValueChange={(value) =>
              onFilterChange(value as "all" | "new" | "used")
            }
          >
            <DropdownMenuRadioItem value="all">전체</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="new">
              새로운 상품
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="used">
              사용된 상품
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
