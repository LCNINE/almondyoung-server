import { useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { ArrowLeft, Pencil, RotateCcw, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { useDeleteSku, useRestoreSku, useSku } from "@/lib/services/inventory/skus"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { SkuBasicInfoCard } from "../components/sku-detail/sku-basic-info-card"
import { SkuBarcodesCard } from "../components/sku-detail/sku-barcodes-card"
import { SkuMetadataCard } from "../components/sku-detail/sku-metadata-card"
import { SkuStockSummaryCard } from "../components/sku-detail/sku-stock-summary-card"
import { SkuFormDialog } from "../components/sku-form-dialog"

export default function SkuDetailTemplate() {
  const { skuId } = useParams<{ skuId: string }>()
  const navigate = useNavigate()
  const { data: sku, isLoading } = useSku(skuId!)
  const deleteMutation = useDeleteSku()
  const restoreMutation = useRestoreSku()
  const [editOpen, setEditOpen] = useState(false)

  const handleDelete = async () => {
    if (!sku) return
    if (!confirm("이 SKU를 삭제하시겠습니까?")) return
    try {
      await deleteMutation.mutateAsync(sku.id)
      toast.success("SKU가 삭제되었습니다")
      navigate("/inventory/skus")
    } catch (e) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "삭제 실패"
      toast.error(msg)
    }
  }

  const handleRestore = async () => {
    if (!sku) return
    try {
      await restoreMutation.mutateAsync(sku.id)
      toast.success("SKU가 복원되었습니다")
    } catch {
      toast.error("복원 실패")
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    )
  }

  if (!sku) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted-foreground">SKU를 찾을 수 없습니다</p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => navigate("/inventory/skus")}
        >
          목록으로 돌아가기
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/inventory/skus")}
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            목록
          </Button>
          <h1 className="text-lg font-bold">{sku.name}</h1>
          {sku.isDeleted && <Badge variant="destructive">삭제됨</Badge>}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="mr-1 h-4 w-4" />
            수정
          </Button>
          {sku.isDeleted ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRestore}
              disabled={restoreMutation.isPending}
            >
              <RotateCcw className="mr-1 h-4 w-4" />
              복원
            </Button>
          ) : (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="mr-1 h-4 w-4" />
              삭제
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
        <div className="space-y-4">
          <SkuBasicInfoCard sku={sku} />
          <SkuMetadataCard sku={sku} />
        </div>
        <div className="space-y-4">
          <SkuStockSummaryCard skuId={sku.id} />
          <SkuBarcodesCard sku={sku} />
        </div>
      </div>

      <SkuFormDialog open={editOpen} onOpenChange={setEditOpen} sku={sku} />
    </div>
  )
}
