import { useState } from "react"
import { Plus } from "lucide-react"
import { useTagGroups } from "@/lib/services/catalog/tags"
import { Container } from "@/components/common/container"
import { PageHeader } from "@/components/common/page-header"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { TagGroupList } from "../components/tag-group-list"
import { TagGroupForm } from "../components/tag-group-form"

export default function TagListTemplate() {
  const { data: groups, isLoading } = useTagGroups()
  const [formOpen, setFormOpen] = useState(false)

  return (
    <Container>
      <PageHeader
        title="태그 관리"
        subtitle="상품 태그 그룹과 값을 관리합니다"
        actions={
          <Button size="sm" onClick={() => setFormOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            태그 그룹 추가
          </Button>
        }
      />
      <div className="p-4">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : groups && groups.length > 0 ? (
          <TagGroupList groups={groups} />
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            태그 그룹이 없습니다
          </p>
        )}
      </div>
      <TagGroupForm open={formOpen} onOpenChange={setFormOpen} />
    </Container>
  )
}
