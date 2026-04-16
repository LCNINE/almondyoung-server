import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useCreateCategory, useUpdateCategory, useDeleteCategory } from "@/lib/services/catalog/categories"
import type { CategoryDto } from "@/lib/types/catalog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from "sonner"
import { Trash2 } from "lucide-react"

const schema = z.object({
  name: z.string().min(1, "카테고리명을 입력해주세요").max(255),
  description: z.string().optional(),
  slug: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

type CategoryFormProps = {
  category?: CategoryDto
  parentId?: string
  onSuccess?: () => void
}

export function CategoryForm({ category, parentId, onSuccess }: CategoryFormProps) {
  const isEdit = !!category
  const createMutation = useCreateCategory()
  const updateMutation = useUpdateCategory()
  const deleteMutation = useDeleteCategory()

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: category?.name ?? "",
      description: category?.description ?? "",
      slug: category?.slug ?? "",
    },
  })

  const onSubmit = async (values: FormValues) => {
    try {
      if (isEdit) {
        await updateMutation.mutateAsync({ id: category.id, dto: values })
        toast.success("카테고리가 수정되었습니다")
      } else {
        await createMutation.mutateAsync({ ...values, parentId })
        toast.success("카테고리가 생성되었습니다")
        reset()
      }
      onSuccess?.()
    } catch {
      toast.error(isEdit ? "수정 실패" : "생성 실패")
    }
  }

  const handleDelete = async () => {
    if (!category) return
    if (!confirm("이 카테고리를 삭제하시겠습니까?")) return
    try {
      await deleteMutation.mutateAsync({ id: category.id })
      toast.success("카테고리가 삭제되었습니다")
      onSuccess?.()
    } catch {
      toast.error("삭제 실패")
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            {isEdit ? "카테고리 수정" : "새 카테고리"}
          </CardTitle>
          {isEdit && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">이름</Label>
            <Input id="name" {...register("name")} />
            {errors.name && (
              <p className="text-xs text-destructive">{errors.name.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="slug">슬러그</Label>
            <Input id="slug" {...register("slug")} placeholder="자동 생성" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">설명</Label>
            <Textarea
              id="description"
              {...register("description")}
              rows={3}
            />
          </div>
          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isEdit ? "수정" : "생성"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
