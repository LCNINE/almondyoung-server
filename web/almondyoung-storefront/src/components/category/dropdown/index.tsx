import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu"
import { StoreProductCategoryTree } from "@/lib/types/medusa-category"
import { CategoryColumn } from "./category-column"
import { CategoryDropdownTrigger } from "./category-dropdown-trigger"

interface CategoryDropdownProps {
  categories: StoreProductCategoryTree[]
}

export function CategoryDropdown({ categories }: CategoryDropdownProps) {
  if (categories.length === 0) {
    return null
  }

  return (
    <NavigationMenu className="z-[100] hidden md:flex [&_.origin-top-center]:z-[100] [&_.origin-top-center]:mt-0 [&_.origin-top-center]:animate-none! [&_.origin-top-center]:rounded-none [&_.origin-top-center]:border-0 [&_.origin-top-center]:bg-transparent [&_.origin-top-center]:shadow-none [&_.origin-top-center]:duration-0 [&>div]:z-[100]">
      <NavigationMenuList>
        <NavigationMenuItem>
          <NavigationMenuTrigger className="group/trigger h-10 cursor-pointer gap-2 rounded-t-md border border-transparent bg-transparent px-4 text-sm font-medium text-white transition-colors hover:bg-white/10 hover:text-white focus:bg-white/10 focus:text-white data-[state=open]:rounded-b-none data-[state=open]:border-gray-200 data-[state=open]:border-b-transparent data-[state=open]:bg-white data-[state=open]:text-gray-900 data-[state=open]:hover:bg-white data-[state=open]:hover:text-gray-900 [&>svg:last-child]:hidden">
            <CategoryDropdownTrigger />
          </NavigationMenuTrigger>

          <NavigationMenuContent className="left-0 animate-none!">
            <div className="w-[min(1280px,calc(100vw-80px))] rounded-tr-lg rounded-b-lg border border-gray-200 bg-white p-6 shadow-xl">
              <div className="grid grid-cols-[repeat(auto-fit,minmax(115px,1fr))] gap-x-3 gap-y-8">
                {categories.map((category) => (
                  <CategoryColumn key={category.id} category={category} />
                ))}
              </div>
            </div>
          </NavigationMenuContent>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  )
}
