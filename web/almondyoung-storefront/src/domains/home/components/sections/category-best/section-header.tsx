import { Button } from "@/components/ui/button"
import { CategorySheet } from "@components/category/category-sheet"

export function SectionHeader() {
  return (
    <div className="flex items-center justify-between md:justify-center">
      <h2 className="text-[22px] font-bold md:text-[26px]">
        카테고리 <span className="text-yellow-30">베스트</span>
      </h2>

      <CategorySheet
        trigger={
          <Button
            variant="ghost"
            size="sm"
            className="text-gray-40 hover:text-gray-90 hover:bg-transparent md:hidden"
          >
            <span className="underline underline-offset-4">더보기</span>
          </Button>
        }
      />
    </div>
  )
}
