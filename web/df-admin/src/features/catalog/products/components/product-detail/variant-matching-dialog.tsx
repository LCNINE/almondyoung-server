import { useEffect } from "react"
import { useFieldArray, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Minus, Plus } from "lucide-react"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { SkuSearchSelect } from "@/features/matching/shared/sku-search-select"
import {
  useUpsertVariantMatching,
  useVariantMatching,
} from "@/lib/services/matching/variant-mapping"
import type { VariantDto } from "@/lib/types/catalog"

const schema = z.object({
  inventoryManagement: z.boolean(),
  preStockSellable: z.boolean(),
  alwaysSellableZeroStock: z.boolean(),
  links: z.array(
    z.object({
      skuId: z.string().min(1, "SKU를 선택하세요"),
      quantity: z.number().min(1, "수량은 1 이상이어야 합니다"),
    })
  ),
})

type FormValues = z.output<typeof schema>

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  variant: VariantDto
  masterId: string
}

export function VariantMatchingDialog({
  open,
  onOpenChange,
  variant,
  masterId,
}: Props) {
  const { data, isLoading } = useVariantMatching(variant.id, open)
  const mutation = useUpsertVariantMatching(variant.id)
  const {
    control,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      inventoryManagement: true,
      preStockSellable: true,
      alwaysSellableZeroStock: false,
      links: [{ skuId: "", quantity: 1 }],
    },
  })

  const { fields, append, remove } = useFieldArray({
    control,
    name: "links",
  })

  useEffect(() => {
    if (!open) return
    reset({
      inventoryManagement: data?.inventoryManagement ?? true,
      preStockSellable: data?.preStockSellable ?? true,
      alwaysSellableZeroStock: data?.alwaysSellableZeroStock ?? false,
      links:
        data?.links?.length && data.links.length > 0
          ? data.links.map((link) => ({
              skuId: link.skuId,
              quantity: link.quantity,
            }))
          : [{ skuId: "", quantity: 1 }],
    })
  }, [data, open, reset])

  const onSubmit = async (values: FormValues) => {
    try {
      await mutation.mutateAsync({
        masterId,
        links: values.links,
        policy: {
          inventoryManagement: values.inventoryManagement,
          preStockSellable: values.preStockSellable,
          alwaysSellableZeroStock: values.alwaysSellableZeroStock,
        },
      })
      toast.success("Variant 매핑이 저장되었습니다")
      onOpenChange(false)
    } catch (error) {
      const message =
        (error as { response?: { data?: { message?: string } } })?.response
          ?.data?.message ?? "Variant 매핑 저장에 실패했습니다"
      toast.error(message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Variant 매핑 편집</DialogTitle>
          <DialogDescription>
            {variant.optionValues
              ?.map((ov) => `${ov.groupName}: ${ov.value}`)
              .join(", ") ||
              variant.sku ||
              variant.id}
          </DialogDescription>
        </DialogHeader>

        <form
          id="variant-matching-form"
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-4"
        >
          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">SKU 링크</p>
                <p className="text-xs text-muted-foreground">
                  Variant에 연결할 SKU와 수량을 정의합니다.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => append({ skuId: "", quantity: 1 })}
              >
                <Plus className="mr-1 h-4 w-4" />
                링크 추가
              </Button>
            </div>

            {fields.map((field, index) => (
              <div
                key={field.id}
                className="grid gap-3 rounded-lg border bg-background p-3 md:grid-cols-[1fr_120px_44px]"
              >
                <SkuSearchSelect
                  value={watch(`links.${index}.skuId`)}
                  onChange={(skuId) =>
                    setValue(`links.${index}.skuId`, skuId, {
                      shouldDirty: true,
                    })
                  }
                  selectedLabel={watch(`links.${index}.skuId`) || undefined}
                />
                <div className="space-y-2">
                  <Label>수량</Label>
                  <Input
                    type="number"
                    min={1}
                    value={watch(`links.${index}.quantity`) || 1}
                    onChange={(e) =>
                      setValue(
                        `links.${index}.quantity`,
                        Number(e.target.value) || 1,
                        { shouldDirty: true }
                      )
                    }
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    disabled={fields.length === 1}
                    onClick={() => remove(index)}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}

            {errors.links?.message && (
              <p className="text-xs text-destructive">{errors.links.message}</p>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <PolicySwitch
              title="재고 관리"
              checked={watch("inventoryManagement")}
              onCheckedChange={(checked) =>
                setValue("inventoryManagement", checked, { shouldDirty: true })
              }
            />
            <PolicySwitch
              title="프리스톡 판매"
              checked={watch("preStockSellable")}
              onCheckedChange={(checked) =>
                setValue("preStockSellable", checked, { shouldDirty: true })
              }
            />
            <PolicySwitch
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
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            취소
          </Button>
          <Button
            type="submit"
            form="variant-matching-form"
            disabled={isSubmitting || mutation.isPending || isLoading}
          >
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PolicySwitch({
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
