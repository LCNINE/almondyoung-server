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
import { Switch } from "@/components/ui/switch"
import { useUpdateStockPolicy } from "@/lib/services/matching/order-lines"
import type { OrderLineRow } from "@/lib/types/matching"

const schema = z.object({
  inventoryManagement: z.boolean(),
  preStockSellable: z.boolean(),
  alwaysSellableZeroStock: z.boolean(),
})

type FormValues = z.output<typeof schema>

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  row: OrderLineRow
}

export function StockPolicyDialog({ open, onOpenChange, row }: Props) {
  const mutation = useUpdateStockPolicy()
  const { handleSubmit, reset, setValue, watch } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      inventoryManagement: true,
      preStockSellable: true,
      alwaysSellableZeroStock: false,
    },
  })

  useEffect(() => {
    if (!open) return
    reset({
      inventoryManagement: true,
      preStockSellable: true,
      alwaysSellableZeroStock: false,
    })
  }, [open, reset])

  const onSubmit = async (values: FormValues) => {
    if (!row.matchingId) return

    try {
      await mutation.mutateAsync({
        matchingId: row.matchingId,
        policy: values,
      })
      toast.success("재고 정책이 변경되었습니다")
      onOpenChange(false)
    } catch (error) {
      const message =
        (error as { response?: { data?: { message?: string } } })?.response
          ?.data?.message ?? "재고 정책 변경에 실패했습니다"
      toast.error(message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>재고 정책</DialogTitle>
          <DialogDescription>
            현재 매칭에 적용할 재고 처리 정책을 설정합니다.
          </DialogDescription>
        </DialogHeader>
        <form id="stock-policy-form" onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-3">
            <PolicyRow
              title="재고 관리"
              checked={watch("inventoryManagement")}
              onCheckedChange={(checked) =>
                setValue("inventoryManagement", checked, { shouldDirty: true })
              }
            />
            <PolicyRow
              title="프리스톡 판매"
              checked={watch("preStockSellable")}
              onCheckedChange={(checked) =>
                setValue("preStockSellable", checked, { shouldDirty: true })
              }
            />
            <PolicyRow
              title="0재고 허용"
              checked={watch("alwaysSellableZeroStock")}
              onCheckedChange={(checked) =>
                setValue("alwaysSellableZeroStock", checked, {
                  shouldDirty: true,
                })
              }
            />
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            type="submit"
            form="stock-policy-form"
            disabled={mutation.isPending || !row.matchingId}
          >
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PolicyRow({
  title,
  checked,
  onCheckedChange,
}: {
  title: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border p-3">
      <span className="font-medium">{title}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}
