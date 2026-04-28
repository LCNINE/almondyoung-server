'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useCreatePurchaseOrder,
  useUpdatePurchaseOrderLines,
  useSuppliers,
  useWarehouses,
} from '@/lib/services/inventory';
import type {
  PurchaseOrderDto,
  PurchaseOrderType,
  CreatePurchaseOrderLineRequest,
} from '@/lib/types/dto/inventory';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editLinesFor?: PurchaseOrderDto | null;
};

const EMPTY_LINE: CreatePurchaseOrderLineRequest = { skuId: '', quantity: 1 };

export function PurchaseOrderFormDialog({ open, onOpenChange, editLinesFor }: Props) {
  const isEditLines = !!editLinesFor;

  const [type, setType] = useState<PurchaseOrderType>('domestic');
  const [supplierId, setSupplierId] = useState('');
  const [expectedArrival, setExpectedArrival] = useState('');
  const [destinationWarehouseId, setDestinationWarehouseId] = useState('');
  const [lines, setLines] = useState<CreatePurchaseOrderLineRequest[]>([{ ...EMPTY_LINE }]);

  const { data: suppliers } = useSuppliers();
  const { data: warehouses } = useWarehouses();

  const createMutation = useCreatePurchaseOrder();
  const updateLinesMutation = useUpdatePurchaseOrderLines();

  useEffect(() => {
    if (!open) return;
    if (isEditLines && editLinesFor) {
      setLines(
        editLinesFor.lines.map((l) => ({
          skuId: l.skuId,
          quantity: l.quantity,
          unitPrice: l.unitPrice ?? undefined,
        }))
      );
    } else {
      setType('domestic');
      setSupplierId('');
      setExpectedArrival('');
      setDestinationWarehouseId('');
      setLines([{ ...EMPTY_LINE }]);
    }
  }, [open, isEditLines, editLinesFor]);

  const handleLineChange = (
    index: number,
    field: keyof CreatePurchaseOrderLineRequest,
    value: string | number
  ) => {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  };

  const addLine = () => setLines((prev) => [...prev, { ...EMPTY_LINE }]);
  const removeLine = (index: number) =>
    setLines((prev) => prev.filter((_, i) => i !== index));

  const handleSubmit = async () => {
    const validLines = lines.filter((l) => l.skuId.trim());
    if (validLines.length === 0) {
      toast.error('발주 라인을 1개 이상 입력해주세요.');
      return;
    }

    try {
      if (isEditLines && editLinesFor) {
        await updateLinesMutation.mutateAsync({
          id: editLinesFor.id,
          data: { lines: validLines },
        });
        toast.success('발주 라인이 수정되었습니다.');
      } else {
        if (!supplierId) { toast.error('공급처를 선택해주세요.'); return; }
        if (!destinationWarehouseId) { toast.error('목적지 창고를 선택해주세요.'); return; }
        await createMutation.mutateAsync({
          type,
          supplierId,
          expectedArrival: expectedArrival || undefined,
          destinationWarehouseId,
          lines: validLines,
        });
        toast.success('발주가 생성되었습니다.');
      }
      onOpenChange(false);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '저장에 실패했습니다.');
    }
  };

  const isPending = createMutation.isPending || updateLinesMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditLines ? '발주 라인 수정' : '발주 생성'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {!isEditLines && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>발주 유형</Label>
                  <Select value={type} onValueChange={(v) => setType(v as PurchaseOrderType)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="domestic">국내</SelectItem>
                      <SelectItem value="foreign">해외</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>입고 예정일</Label>
                  <Input
                    type="date"
                    value={expectedArrival}
                    onChange={(e) => setExpectedArrival(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>공급처 *</Label>
                <Select value={supplierId} onValueChange={setSupplierId}>
                  <SelectTrigger>
                    <SelectValue placeholder="공급처 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {(suppliers?.data ?? []).map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>목적지 창고 *</Label>
                <Select value={destinationWarehouseId} onValueChange={setDestinationWarehouseId}>
                  <SelectTrigger>
                    <SelectValue placeholder="창고 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {(warehouses ?? []).map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {/* 라인 목록 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>발주 라인 *</Label>
              <Button type="button" size="sm" variant="outline" onClick={addLine}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                라인 추가
              </Button>
            </div>
            {lines.map((line, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  placeholder="SKU ID"
                  value={line.skuId}
                  onChange={(e) => handleLineChange(i, 'skuId', e.target.value)}
                  className="flex-1 font-mono text-xs"
                />
                <Input
                  type="number"
                  placeholder="수량"
                  min={1}
                  value={line.quantity}
                  onChange={(e) => handleLineChange(i, 'quantity', Number(e.target.value))}
                  className="w-20"
                />
                <Input
                  type="number"
                  placeholder="단가"
                  min={0}
                  value={line.unitPrice ?? ''}
                  onChange={(e) =>
                    handleLineChange(i, 'unitPrice', e.target.value ? Number(e.target.value) : '')
                  }
                  className="w-24"
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => removeLine(i)}
                  disabled={lines.length === 1}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? '저장 중...' : isEditLines ? '라인 저장' : '발주 생성'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
