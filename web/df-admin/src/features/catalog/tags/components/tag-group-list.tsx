import { useState } from "react"
import { Plus, Trash2, X } from "lucide-react"
import type { TagGroupDto } from "@/lib/types/catalog"
import {
  useCreateTagValue,
  useDeleteTagGroup,
  useDeleteTagValue,
} from "@/lib/services/catalog/tags"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"

export function TagGroupList({ groups }: { groups: TagGroupDto[] }) {
  return (
    <Accordion type="multiple" className="w-full">
      {groups.map((group) => (
        <TagGroupItem key={group.id} group={group} />
      ))}
    </Accordion>
  )
}

function TagGroupItem({ group }: { group: TagGroupDto }) {
  const [newValueName, setNewValueName] = useState("")
  const [adding, setAdding] = useState(false)
  const createValue = useCreateTagValue()
  const deleteGroup = useDeleteTagGroup()
  const deleteValue = useDeleteTagValue()

  const handleAddValue = async () => {
    if (!newValueName.trim()) return
    try {
      await createValue.mutateAsync({
        groupId: group.id,
        dto: { name: newValueName.trim() },
      })
      setNewValueName("")
      setAdding(false)
      toast.success("태그 값이 추가되었습니다")
    } catch {
      toast.error("태그 값 추가 실패")
    }
  }

  const handleDeleteGroup = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm(`"${group.name}" 태그 그룹을 삭제하시겠습니까?`)) return
    try {
      await deleteGroup.mutateAsync(group.id)
      toast.success("태그 그룹이 삭제되었습니다")
    } catch {
      toast.error("태그 그룹 삭제 실패")
    }
  }

  const handleDeleteValue = async (valueId: string) => {
    try {
      await deleteValue.mutateAsync(valueId)
      toast.success("태그 값이 삭제되었습니다")
    } catch {
      toast.error("태그 값 삭제 실패")
    }
  }

  return (
    <AccordionItem value={group.id}>
      <AccordionTrigger className="px-3 hover:no-underline">
        <div className="flex items-center gap-2">
          <span className="font-medium">{group.name}</span>
          <Badge variant="secondary" className="text-xs">
            {group.values?.length ?? 0}
          </Badge>
          {!group.isActive && (
            <Badge variant="outline" className="text-xs">
              비활성
            </Badge>
          )}
        </div>
      </AccordionTrigger>
      <AccordionContent className="px-3 pb-3">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {group.description || "설명 없음"}
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDeleteGroup}
            disabled={deleteGroup.isPending}
          >
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {group.values?.map((value) => (
            <Badge key={value.id} variant="secondary" className="gap-1 pr-1">
              {value.name}
              <button
                type="button"
                onClick={() => handleDeleteValue(value.id)}
                className="ml-0.5 rounded-full hover:bg-muted"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>

        <div className="mt-3">
          {adding ? (
            <div className="flex items-center gap-2">
              <Input
                autoFocus
                value={newValueName}
                onChange={(e) => setNewValueName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddValue()
                  if (e.key === "Escape") setAdding(false)
                }}
                placeholder="태그 값 이름"
                className="h-8 text-sm"
              />
              <Button
                size="sm"
                onClick={handleAddValue}
                disabled={createValue.isPending}
              >
                추가
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setAdding(false)}
              >
                취소
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAdding(true)}
              className="h-7 text-xs"
            >
              <Plus className="mr-1 h-3 w-3" />
              값 추가
            </Button>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  )
}
