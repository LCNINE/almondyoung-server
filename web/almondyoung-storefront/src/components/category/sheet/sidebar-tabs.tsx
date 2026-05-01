import { Button } from "@/components/ui/button"
import { StoreProductCategoryTree } from "@/lib/types/medusa-category"
import { cn } from "@/lib/utils"
import { useEffect, useRef } from "react"

interface SidebarTabsProps {
  categories: StoreProductCategoryTree[]
  activeId: string | null
  onSelect: (id: string) => void
}

export function SidebarTabs({ categories, activeId, onSelect }: SidebarTabsProps) {
  const asideRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!activeId) return
    const el = asideRef.current?.querySelector<HTMLElement>(
      `[data-tab-id="${activeId}"]`
    )
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" })
  }, [activeId])

  return (
    <aside
      ref={asideRef}
      className="w-[110px] shrink-0 overflow-y-auto border-r border-gray-50 bg-[#F9F9F9]"
    >
      {categories.map((cat) => {
        const isActive = activeId === cat.id
        return (
          <Button
            key={cat.id}
            type="button"
            variant="ghost"
            data-tab-id={cat.id}
            onClick={() => onSelect(cat.id)}
            className={cn(
              "relative h-auto w-full justify-start rounded-none py-3.5 pr-2 pl-4 text-left text-[11.5px] leading-snug break-keep whitespace-normal transition-all hover:bg-transparent",
              isActive
                ? "bg-white font-bold text-black hover:bg-white hover:text-black"
                : "text-gray-400 hover:text-gray-600"
            )}
          >
            {isActive && (
              <span className="absolute top-1/2 left-0 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-black" />
            )}
            {cat.name}
          </Button>
        )
      })}
    </aside>
  )
}
