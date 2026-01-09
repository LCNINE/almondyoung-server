import { TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CategoryTreeNodeDto } from "@lib/api/pim"
import { cn } from "@lib/utils"
import { motion } from "framer-motion"

interface CategoryTabsProps {
  categories: CategoryTreeNodeDto[]
  activeTab: string
  dragHandlers: any // For simplicity, though React.HTMLAttributes<HTMLDivElement> would be more precise
}

export function CategoryTabs({
  categories,
  activeTab,
  dragHandlers,
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
          value={category.name}
          className={cn(
            "relative cursor-pointer rounded-xl border border-gray-200 px-5 transition-colors",
            "data-[state=active]:text-gray-10 data-[state=active]:border-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none",
            "min-w-fit"
          )}
        >
          <span className="relative z-10">{category.name}</span>

          {activeTab === category.name && (
            <motion.div
              layoutId="active-pill-bg"
              className="bg-gray-80 absolute inset-0 z-0 rounded-xl"
              transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
            />
          )}
        </TabsTrigger>
      ))}
    </TabsList>
  )
}

