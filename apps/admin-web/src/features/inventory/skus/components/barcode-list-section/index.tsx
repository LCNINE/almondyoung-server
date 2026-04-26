'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { X, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/common/form/form-input';
import { useAddBarcode, useRemoveBarcode } from '@/lib/services/inventory';
import type { BarcodeDto } from '@/lib/types/dto/inventory';

type Props = {
  skuId: string;
  barcodes: BarcodeDto[];
};

export function BarcodeListSection({ skuId, barcodes }: Props) {
  const [newBarcode, setNewBarcode] = useState('');
  const [newPackingUnit, setNewPackingUnit] = useState('');

  const addMutation = useAddBarcode();
  const removeMutation = useRemoveBarcode();

  const handleAdd = async () => {
    const trimmed = newBarcode.trim();
    if (!trimmed) return;

    try {
      await addMutation.mutateAsync({
        skuId,
        data: {
          barcode: trimmed,
          packingUnit: newPackingUnit ? Number(newPackingUnit) : undefined,
        },
      });
      setNewBarcode('');
      setNewPackingUnit('');
      toast.success('바코드가 추가되었습니다.');
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? e?.message ?? '바코드 추가에 실패했습니다.';
      toast.error(msg);
    }
  };

  const handleRemove = async (barcodeId: string, isPrimary: boolean) => {
    if (isPrimary) {
      toast.error('주 바코드는 삭제할 수 없습니다.');
      return;
    }
    try {
      await removeMutation.mutateAsync({ skuId, barcodeId });
      toast.success('바코드가 삭제되었습니다.');
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? e?.message ?? '바코드 삭제에 실패했습니다.';
      toast.error(msg);
    }
  };

  return (
    <div className="space-y-2">
      {barcodes.map((b) => (
        <div key={b.id} className="flex items-center gap-2 rounded border px-3 py-1.5 text-sm">
          <span className="flex-1 font-mono text-xs">{b.barcode}</span>
          {b.packingUnit && (
            <span className="text-xs text-muted-foreground">
              {b.packingUnit}개입
            </span>
          )}
          {b.isPrimary && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              주
            </span>
          )}
          <button
            type="button"
            className="ml-1 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-40"
            onClick={() => handleRemove(b.id, b.isPrimary)}
            disabled={removeMutation.isPending || b.isPrimary}
            aria-label="바코드 삭제"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}

      <div className="flex items-center gap-2">
        <FormInput
          className="h-8 text-xs font-mono"
          placeholder="새 바코드"
          value={newBarcode}
          onChange={(e) => setNewBarcode(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
        />
        <FormInput
          className="h-8 w-20 text-xs"
          type="number"
          placeholder="개입"
          min={1}
          value={newPackingUnit}
          onChange={(e) => setNewPackingUnit(e.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 px-2"
          onClick={handleAdd}
          disabled={addMutation.isPending || !newBarcode.trim()}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
