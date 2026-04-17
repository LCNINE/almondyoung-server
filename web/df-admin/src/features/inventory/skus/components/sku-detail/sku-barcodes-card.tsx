import { useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import type { SkuDto } from "@/lib/types/inventory"
import { useAddBarcode, useRemoveBarcode } from "@/lib/services/inventory/skus"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function SkuBarcodesCard({ sku }: { sku: SkuDto }) {
  const [open, setOpen] = useState(false)
  const [barcode, setBarcode] = useState("")
  const [packingUnit, setPackingUnit] = useState("")
  const addMutation = useAddBarcode(sku.id)
  const removeMutation = useRemoveBarcode(sku.id)

  const handleAdd = async () => {
    if (!barcode.trim()) {
      toast.error("바코드를 입력하세요")
      return
    }
    try {
      await addMutation.mutateAsync({
        barcode: barcode.trim(),
        packingUnit: packingUnit.trim() || undefined,
      })
      toast.success("바코드가 추가되었습니다")
      setBarcode("")
      setPackingUnit("")
      setOpen(false)
    } catch (e) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "바코드 추가 실패"
      toast.error(msg)
    }
  }

  const handleRemove = async (barcodeId: string, isPrimary: boolean) => {
    if (isPrimary) {
      toast.error("기본 바코드는 제거할 수 없습니다")
      return
    }
    if (!confirm("이 바코드를 제거하시겠습니까?")) return
    try {
      await removeMutation.mutateAsync(barcodeId)
      toast.success("바코드가 제거되었습니다")
    } catch (e) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "제거 실패"
      toast.error(msg)
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">바코드</CardTitle>
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              추가
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {sku.barcodes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              등록된 바코드가 없습니다.
            </p>
          ) : (
            <ul className="space-y-2">
              {sku.barcodes.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center justify-between rounded border px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm">{b.barcode}</span>
                    {b.isPrimary && (
                      <Badge variant="default" className="text-xs">
                        기본
                      </Badge>
                    )}
                    {b.packingUnit && (
                      <Badge variant="outline" className="text-xs">
                        {b.packingUnit}
                      </Badge>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={b.isPrimary || removeMutation.isPending}
                    onClick={() => handleRemove(b.id, b.isPrimary)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>바코드 추가</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="barcode">바코드</Label>
              <Input
                id="barcode"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="packingUnit">포장 단위 (선택)</Label>
              <Input
                id="packingUnit"
                value={packingUnit}
                onChange={(e) => setPackingUnit(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button onClick={handleAdd} disabled={addMutation.isPending}>
              추가
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
