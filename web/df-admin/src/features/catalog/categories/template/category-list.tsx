import { useState } from "react"
import { Plus } from "lucide-react"
import { useCategoryTree } from "@/lib/services/catalog/categories"
import type { CategoryTreeNode } from "@/lib/types/catalog"
import { Container } from "@/components/common/container"
import { PageHeader } from "@/components/common/page-header"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { CategoryTree } from "../components/category-tree"
import { CategoryForm } from "../components/category-form"

export default function CategoryListTemplate() {
  const { data, isLoading } = useCategoryTree()
  const [selected, setSelected] = useState<CategoryTreeNode | null>(null)
  const [creating, setCreating] = useState(false)

  const handleSelect = (node: CategoryTreeNode) => {
    setSelected(node)
    setCreating(false)
  }

  const handleCreate = () => {
    setSelected(null)
    setCreating(true)
  }

  const handleSuccess = () => {
    setSelected(null)
    setCreating(false)
  }

  return (
    <Container>
      <PageHeader
        title="카테고리 관리"
        subtitle="상품 카테고리를 관리합니다"
        actions={
          <Button size="sm" onClick={handleCreate}>
            <Plus className="mr-1 h-4 w-4" />
            카테고리 추가
          </Button>
        }
      />
      <div className="grid gap-4 p-4 xl:grid-cols-[1fr_380px]">
        <div className="min-h-[400px] rounded-md border p-3">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : data?.tree && data.tree.length > 0 ? (
            <CategoryTree
              nodes={data.tree}
              selectedId={selected?.id}
              onSelect={handleSelect}
            />
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              카테고리가 없습니다
            </p>
          )}
        </div>

        <div>
          {creating && (
            <CategoryForm
              parentId={selected?.id}
              onSuccess={handleSuccess}
            />
          )}
          {selected && !creating && (
            <CategoryForm
              key={selected.id}
              category={selected}
              onSuccess={handleSuccess}
            />
          )}
          {!creating && !selected && (
            <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">
              카테고리를 선택하거나 새로 추가하세요
            </div>
          )}
        </div>
      </div>
    </Container>
  )
}
