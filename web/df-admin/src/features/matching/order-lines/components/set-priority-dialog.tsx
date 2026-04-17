import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useSetMatchingPriority } from "@/lib/services/matching/order-lines"
import type { MatchingPriority, OrderLineRow } from "@/lib/types/matching"

const schema = z.object({
  priority: z.enum(["high", "normal"]),
})

type FormValues = z.output<typeof schema>

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  row: OrderLineRow
}

export function SetPriorityDialog({ open, onOpenChange, row }: Props) {
  const mutation = useSetMatchingPriority()
  const { handleSubmit, reset, setValue, watch } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      priority: "high",
    },
  })

  useEffect(() => {
    if (open) reset({ priority: "high" })
  }, [open, reset])

  const onSubmit = async (values: FormValues) => {
    if (!row.matchingId) return

    try {
      await mutation.mutateAsync({
        matchingId: row.matchingId,
        priority: values.priority,
      })
      toast.success("우선순위가 변경되었습니다")
      onOpenChange(false)
    } catch (error) {
      const message =
        (error as { response?: { data?: { message?: string } } })?.response
          ?.data?.message ?? "우선순위 변경에 실패했습니다"
      toast.error(message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>우선순위 변경</DialogTitle>
          <DialogDescription>
            미해결 매칭 건의 우선순위를 조정합니다.
          </DialogDescription>
        </DialogHeader>
        <form id="set-priority-form" onSubmit={handleSubmit(onSubmit)}>
          <Select
            value={watch("priority")}
            onValueChange={(value) =>
              setValue("priority", value as MatchingPriority, {
                shouldDirty: true,
              })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="high">높음</SelectItem>
              <SelectItem value="normal">보통</SelectItem>
            </SelectContent>
          </Select>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            type="submit"
            form="set-priority-form"
            disabled={mutation.isPending || !row.matchingId}
          >
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
