import { getCategoryTree } from "@lib/api/medusa/categories"
import { CategorySidebarWrapper } from "@/domains/products/category/components/category-sidebar-wrapper"

export default async function CategoryLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ countryCode: string }>
}) {
  const { countryCode } = await params
  const allCategories = await getCategoryTree()

  return (
    <div className="bg-background">
      <main>
        <div className="container mx-auto max-w-[1360px]">
          <div className="flex px-4 py-6 md:gap-[40px] md:px-[40px]">
            <aside className="hidden w-[233px] shrink-0 md:block">
              <CategorySidebarWrapper
                categories={allCategories}
                countryCode={countryCode}
              />
            </aside>
            <div className="min-w-0 flex-1">{children}</div>
          </div>
        </div>
      </main>
    </div>
  )
}
