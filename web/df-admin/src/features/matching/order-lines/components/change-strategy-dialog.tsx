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
import { useChangeMatchingStrategy } from "@/lib/services/matching/order-lines"
import type { MatchingStrategy, OrderLineRow } from "@/lib/types/matching"

const schema = z.object({
  strategy: z.enum(["variant", "void"]),
})

type FormValues = z.output<typeof schema>

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  row: OrderLineRow
}

export function ChangeStrategyDialog({ open, onOpenChange, row }: Props) {
  const mutation = useChangeMatchingStrategy()
  const { handleSubmit, reset, setValue, watch } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      strategy: "variant",
    },
  })

  useEffect(() => {
    if (open) reset({ strategy: "variant" })
  }, [open, reset])

  const onSubmit = async (values: FormValues) => {
    if (!row.matchingId) return

    try {
      await mutation.mutateAsync({
        matchingId: row.matchingId,
        strategy: values.strategy,
      })
      toast.success("전략이 변경되었습니다")
      onOpenChange(false)
    } catch (error) {
      const message =
        (error as { response?: { data?: { message?: string } } })?.response
          ?.data?.message ?? "전략 변경에 실패했습니다"
      toast.error(message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>전략 변경</DialogTitle>
          <DialogDescription>
            미해결 매칭 건의 처리 전략을 변경합니다.
          </DialogDescription>
        </DialogHeader>
        <form id="change-strategy-form" onSubmit={handleSubmit(onSubmit)}>
          <Select
            value={watch("strategy")}
            onValueChange={(value) =>
              setValue("strategy", value as MatchingStrategy, {
                shouldDirty: true,
              })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="variant">Variant</SelectItem>
              <SelectItem value="void">Void</SelectItem>
            </SelectContent>
          </Select>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            type="submit"
            form="change-strategy-form"
            disabled={mutation.isPending || !row.matchingId}
          >
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
