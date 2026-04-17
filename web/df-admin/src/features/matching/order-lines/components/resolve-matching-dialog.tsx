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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { SkuSearchSelect } from "@/features/matching/shared/sku-search-select"
import { useResolveMatching } from "@/lib/services/matching/order-lines"
import type { MatchingStrategy, OrderLineRow } from "@/lib/types/matching"

const schema = z
  .object({
    ignore: z.boolean(),
    strategy: z.enum(["variant", "void"]),
    isGift: z.boolean(),
    inventoryManagement: z.boolean(),
    preStockSellable: z.boolean(),
    alwaysSellableZeroStock: z.boolean(),
    skuMappings: z.array(
      z.object({
        skuId: z.string().min(1, "SKU를 선택하세요"),
        quantity: z.number().min(1, "수량은 1 이상이어야 합니다"),
      })
    ),
  })
  .superRefine((values, ctx) => {
    if (!values.ignore && values.skuMappings.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["skuMappings"],
        message: "최소 1개의 SKU를 선택하세요",
      })
    }
  })

type FormValues = z.output<typeof schema>

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  row: OrderLineRow
}

export function ResolveMatchingDialog({ open, onOpenChange, row }: Props) {
  const mutation = useResolveMatching()
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
      ignore: false,
      strategy: "variant",
      isGift: false,
      inventoryManagement: true,
      preStockSellable: true,
      alwaysSellableZeroStock: false,
      skuMappings: [{ skuId: "", quantity: 1 }],
    },
  })
  const { fields, append, remove } = useFieldArray({
    control,
    name: "skuMappings",
  })

  useEffect(() => {
    if (!open) return
    reset({
      ignore: false,
      strategy: "variant",
      isGift: false,
      inventoryManagement: true,
      preStockSellable: true,
      alwaysSellableZeroStock: false,
      skuMappings: [{ skuId: "", quantity: Math.max(row.quantity, 1) }],
    })
  }, [open, reset, row.quantity])

  const ignore = watch("ignore")
  const strategy = watch("strategy")

  const onSubmit = async (values: FormValues) => {
    if (!row.matchingId) return

    try {
      await mutation.mutateAsync({
        matchingId: row.matchingId,
        dto: values.ignore
          ? { ignore: true }
          : {
              ignore: false,
              strategy: values.strategy,
              isGift: values.isGift,
              stockPolicy: {
                inventoryManagement: values.inventoryManagement,
                preStockSellable: values.preStockSellable,
                alwaysSellableZeroStock: values.alwaysSellableZeroStock,
              },
              skuMappings: values.skuMappings.map((mapping) => ({
                skuId: mapping.skuId,
                quantity: mapping.quantity,
              })),
            },
      })
      toast.success("주문 매칭이 처리되었습니다")
      onOpenChange(false)
    } catch (error) {
      const message =
        (error as { response?: { data?: { message?: string } } })?.response
          ?.data?.message ?? "주문 매칭 처리에 실패했습니다"
      toast.error(message)
    }
  }

  const setStrategy = (value: string) => {
    setValue("strategy", value as MatchingStrategy, { shouldDirty: true })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>매칭 해소</DialogTitle>
          <DialogDescription>
            {row.productName} 주문 라인을 SKU에 연결하거나 무시 처리합니다.
          </DialogDescription>
        </DialogHeader>

        <form
          id="resolve-matching-form"
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-4"
        >
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <p className="font-medium">{row.productName}</p>
            <p className="mt-1 text-muted-foreground">
              주문번호 {row.channelOrderId} · 수량 {row.quantity}개
            </p>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="font-medium">무시 처리</p>
              <p className="text-xs text-muted-foreground">
                재고 매칭 없이 주문 라인을 종료합니다.
              </p>
            </div>
            <Switch
              checked={ignore}
              onCheckedChange={(checked) =>
                setValue("ignore", checked, { shouldDirty: true })
              }
            />
          </div>

          {!ignore && (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>전략</Label>
                  <Select value={strategy} onValueChange={setStrategy}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="variant">Variant 매칭</SelectItem>
                      <SelectItem value="void">Void 처리</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="font-medium">사은품 주문</p>
                    <p className="text-xs text-muted-foreground">
                      저장 시 `isGift` 값을 함께 전달합니다.
                    </p>
                  </div>
                  <Switch
                    checked={watch("isGift")}
                    onCheckedChange={(checked) =>
                      setValue("isGift", checked, { shouldDirty: true })
                    }
                  />
                </div>
              </div>

              <div className="space-y-3 rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">SKU 매핑</p>
                    <p className="text-xs text-muted-foreground">
                      주문 라인에 연결할 SKU와 수량을 선택합니다.
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => append({ skuId: "", quantity: 1 })}
                  >
                    <Plus className="mr-1 h-4 w-4" />
                    SKU 추가
                  </Button>
                </div>

                {fields.map((field, index) => (
                  <div
                    key={field.id}
                    className="grid gap-3 rounded-lg border bg-background p-3 md:grid-cols-[1fr_120px_44px]"
                  >
                    <SkuSearchSelect
                      value={watch(`skuMappings.${index}.skuId`)}
                      onChange={(skuId) =>
                        setValue(`skuMappings.${index}.skuId`, skuId, {
                          shouldDirty: true,
                        })
                      }
                    />
                    <div className="space-y-2">
                      <Label>수량</Label>
                      <Input
                        type="number"
                        min={1}
                        value={watch(`skuMappings.${index}.quantity`) || 1}
                        onChange={(e) =>
                          setValue(
                            `skuMappings.${index}.quantity`,
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

                {errors.skuMappings?.message && (
                  <p className="text-xs text-destructive">
                    {errors.skuMappings.message}
                  </p>
                )}
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <PolicySwitch
                  title="재고 관리"
                  checked={watch("inventoryManagement")}
                  onCheckedChange={(checked) =>
                    setValue("inventoryManagement", checked, {
                      shouldDirty: true,
                    })
                  }
                />
                <PolicySwitch
                  title="프리스톡 판매"
                  checked={watch("preStockSellable")}
                  onCheckedChange={(checked) =>
                    setValue("preStockSellable", checked, {
                      shouldDirty: true,
                    })
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
            </>
          )}
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
            form="resolve-matching-form"
            disabled={isSubmitting || mutation.isPending || !row.matchingId}
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
