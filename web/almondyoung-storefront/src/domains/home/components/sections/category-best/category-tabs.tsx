import { TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { CategoryTreeNodeDto } from "@lib/types/dto/pim"
import { cn } from "@lib/utils"
import { motion } from "framer-motion"

interface CategoryTabsProps {
  categories: CategoryTreeNodeDto[]
  activeTab: string
  dragHandlers: React.HTMLAttributes<HTMLDivElement>
  layoutId: string
}

export function CategoryTabs({
  categories,
  activeTab,
  dragHandlers,
  layoutId,
}: CategoryTabsProps) {
  return (
    <TabsList
      {...dragHandlers}
      className={cn(
        "flex h-auto w-full justify-start gap-2 bg-transparent px-0 py-3.5",
        "scrollbar-hide overflow-x-auto select-none active:cursor-grabbing",
        "md:justify-center md:pt-6 md:pb-[19px]"
      )}
      style={{ WebkitOverflowScrolling: "touch" }}
    >
      {categories.map((category) => (
        <TabsTrigger
          key={category.id}
          value={category.slug}
          className={cn(
            "relative cursor-pointer rounded-xl border border-gray-200 px-5 transition-colors",
            "data-[state=active]:text-gray-10 data-[state=active]:border-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none",
            "min-w-fit"
          )}
        >
          <span className="relative z-10">{category.name}</span>

          {activeTab === category.slug && (
            <motion.div
              layoutId={layoutId}
              className="bg-gray-80 absolute inset-0 z-0 rounded-xl"
              transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
            />
          )}
        </TabsTrigger>
      ))}
    </TabsList>
  )
}
