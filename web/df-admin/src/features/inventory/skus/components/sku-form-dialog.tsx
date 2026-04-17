import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useCreateSku, useUpdateSku } from "@/lib/services/inventory/skus"
import type {
  CreateSkuDto,
  SkuDto,
  StockType,
  UpdateSkuDto,
} from "@/lib/types/inventory"

const STOCK_TYPES: { value: StockType; label: string }[] = [
  { value: "physical", label: "사입" },
  { value: "infinite", label: "무제한" },
  { value: "drop_shipped", label: "직배" },
  { value: "consignment", label: "위탁" },
]

const optionalNumber = z.union([z.number(), z.nan()]).optional()

const schema = z.object({
  name: z.string().min(1, "이름을 입력하세요").max(255),
  optionKey: z.string().max(255).optional().or(z.literal("")),
  stockType: z.enum(["physical", "infinite", "drop_shipped", "consignment"]),
  safetyStock: optionalNumber,
  moq: optionalNumber,
  productWeight: optionalNumber,
  dimensionWidth: optionalNumber,
  dimensionHeight: optionalNumber,
  dimensionDepth: optionalNumber,
  productDescription: z.string().optional().or(z.literal("")),
  koreanName: z.string().optional().or(z.literal("")),
})

type FormValues = z.output<typeof schema>

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  sku?: SkuDto
}

function toDto(values: FormValues): CreateSkuDto {
  const str = (v: string | undefined) =>
    v === undefined || v === "" ? undefined : v
  const num = (v: number | undefined) =>
    v === undefined || Number.isNaN(v) ? undefined : v
  return {
    name: values.name,
    stockType: values.stockType,
    optionKey: str(values.optionKey),
    safetyStock: num(values.safetyStock),
    moq: num(values.moq),
    productWeight: num(values.productWeight),
    dimensionWidth: num(values.dimensionWidth),
    dimensionHeight: num(values.dimensionHeight),
    dimensionDepth: num(values.dimensionDepth),
    productDescription: str(values.productDescription),
    koreanName: str(values.koreanName),
  }
}

export function SkuFormDialog({ open, onOpenChange, sku }: Props) {
  const isEdit = !!sku
  const createMutation = useCreateSku()
  const updateMutation = useUpdateSku(sku?.id ?? "")

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: sku?.name ?? "",
      optionKey: sku?.optionKey ?? "",
      stockType: sku?.stockType ?? "physical",
      safetyStock: sku?.safetyStock ?? 0,
      moq: sku?.moq ?? undefined,
      productWeight: sku?.productWeight ?? undefined,
      dimensionWidth: sku?.dimensionWidth ?? undefined,
      dimensionHeight: sku?.dimensionHeight ?? undefined,
      dimensionDepth: sku?.dimensionDepth ?? undefined,
      productDescription: sku?.productDescription ?? "",
      koreanName: sku?.koreanName ?? "",
    },
  })

  useEffect(() => {
    if (open) {
      reset({
        name: sku?.name ?? "",
        optionKey: sku?.optionKey ?? "",
        stockType: sku?.stockType ?? "physical",
        safetyStock: sku?.safetyStock ?? 0,
        moq: sku?.moq ?? undefined,
        productWeight: sku?.productWeight ?? undefined,
        dimensionWidth: sku?.dimensionWidth ?? undefined,
        dimensionHeight: sku?.dimensionHeight ?? undefined,
        dimensionDepth: sku?.dimensionDepth ?? undefined,
        productDescription: sku?.productDescription ?? "",
        koreanName: sku?.koreanName ?? "",
      })
    }
  }, [open, sku, reset])

  const stockType = watch("stockType")

  const onSubmit = async (values: FormValues) => {
    const dto = toDto(values)
    try {
      if (isEdit) {
        await updateMutation.mutateAsync(dto as UpdateSkuDto)
        toast.success("SKU가 수정되었습니다")
      } else {
        await createMutation.mutateAsync(dto)
        toast.success("SKU가 생성되었습니다")
      }
      onOpenChange(false)
    } catch (e) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? (isEdit ? "수정 실패" : "생성 실패")
      toast.error(msg)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "SKU 수정" : "새 SKU"}</DialogTitle>
        </DialogHeader>
        <form
          id="sku-form"
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-2">
              <Label htmlFor="name">이름 *</Label>
              <Input id="name" {...register("name")} />
              {errors.name && (
                <p className="text-xs text-destructive">{errors.name.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="optionKey">옵션</Label>
              <Input
                id="optionKey"
                placeholder="S / 검정"
                {...register("optionKey")}
              />
            </div>

            <div className="space-y-2">
              <Label>재고 유형</Label>
              <Select
                value={stockType}
                onValueChange={(v) =>
                  setValue("stockType", v as StockType, {
                    shouldDirty: true,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STOCK_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="safetyStock">안전재고</Label>
              <Input
                id="safetyStock"
                type="number"
                min={0}
                {...register("safetyStock", { valueAsNumber: true })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="moq">MOQ</Label>
              <Input
                id="moq"
                type="number"
                min={0}
                {...register("moq", { valueAsNumber: true })}
              />
            </div>

            <div className="col-span-2 space-y-2">
              <Label htmlFor="koreanName">한글 상품명</Label>
              <Input id="koreanName" {...register("koreanName")} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="productWeight">무게 (g)</Label>
              <Input
                id="productWeight"
                type="number"
                step="0.01"
                min={0}
                {...register("productWeight", { valueAsNumber: true })}
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-2">
                <Label htmlFor="dimensionWidth">가로 (cm)</Label>
                <Input
                  id="dimensionWidth"
                  type="number"
                  step="0.01"
                  min={0}
                  {...register("dimensionWidth", { valueAsNumber: true })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dimensionHeight">세로 (cm)</Label>
                <Input
                  id="dimensionHeight"
                  type="number"
                  step="0.01"
                  min={0}
                  {...register("dimensionHeight", { valueAsNumber: true })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dimensionDepth">높이 (cm)</Label>
                <Input
                  id="dimensionDepth"
                  type="number"
                  step="0.01"
                  min={0}
                  {...register("dimensionDepth", { valueAsNumber: true })}
                />
              </div>
            </div>

            <div className="col-span-2 space-y-2">
              <Label htmlFor="productDescription">상품 설명</Label>
              <Textarea
                id="productDescription"
                rows={3}
                {...register("productDescription")}
              />
            </div>
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
            form="sku-form"
            disabled={isSubmitting}
          >
            {isEdit ? "수정" : "생성"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
