import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useCreateTagGroup } from "@/lib/services/catalog/tags"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"

const schema = z.object({
  name: z.string().min(1, "태그 그룹명을 입력해주세요"),
  description: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

type TagGroupFormProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TagGroupForm({ open, onOpenChange }: TagGroupFormProps) {
  const createMutation = useCreateTagGroup()

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", description: "" },
  })

  const onSubmit = async (values: FormValues) => {
    try {
      await createMutation.mutateAsync(values)
      toast.success("태그 그룹이 생성되었습니다")
      reset()
      onOpenChange(false)
    } catch {
      toast.error("태그 그룹 생성 실패")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>새 태그 그룹</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tag-group-name">이름</Label>
            <Input id="tag-group-name" {...register("name")} />
            {errors.name && (
              <p className="text-xs text-destructive">{errors.name.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="tag-group-desc">설명</Label>
            <Textarea
              id="tag-group-desc"
              {...register("description")}
              rows={3}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              취소
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              생성
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
