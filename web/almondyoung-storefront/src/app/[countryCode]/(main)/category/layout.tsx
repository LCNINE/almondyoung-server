import { ErrorBoundary } from "@/components/shared/error-boundary"
import { SidebarSkeleton } from "@/components/skeletons/category-page"
import { CategorySidebar } from "@/domains/category/components/category-sidebar"
import { SidebarError } from "@/domains/category/components/category-sidebar/sidebar-error"
import { listCategories } from "@/lib/api/medusa/categories"
import { Suspense } from "react"

export default async function CategoryLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="bg-background">
      <main>
        <div className="container mx-auto max-w-[1360px]">
          <div className="flex px-4 py-6 md:gap-[40px] md:px-[40px]">
            <aside className="hidden w-[233px] shrink-0 md:block">
              <Suspense fallback={<SidebarSkeleton />}>
                <ErrorBoundary fallback={<SidebarError />}>
                  <SidebarWrapper />
                </ErrorBoundary>
              </Suspense>
            </aside>

            <div className="min-w-0 flex-1">{children}</div>
          </div>
        </div>
      </main>
    </div>
  )
}

async function SidebarWrapper() {
  // API에서 최상위 카테고리만 가져옴 (자식은 category_children에 포함)
  const categories = await listCategories({ parent_category_id: "null" })

  return <CategorySidebar categories={categories} />
}
