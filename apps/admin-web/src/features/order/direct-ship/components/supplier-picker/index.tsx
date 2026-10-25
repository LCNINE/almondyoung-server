'use client';

import { Button } from '@/components/ui/button';
import type { SupplierQueueSummary } from '@/lib/types/dto/fulfillment';
import { supplierChipLabel } from '../../lib/supplier-picker';

interface Props {
  summaries: SupplierQueueSummary[];
  selectedId: string | null;
  onSelect: (supplierId: string) => void;
}

/** 탭 위 한 줄 — 다섯 탭 중 알릴 취소를 뺀 넷이 같이 쓴다(N12) */
export function SupplierPicker({ summaries, selectedId, onSelect }: Props) {
  if (summaries.length === 0) {
    return <p className="px-4 pt-2 text-sm text-muted-foreground">열린 직배 상자가 없습니다.</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5 px-4 pt-2">
      {summaries.map((s) => (
        <Button
          key={s.supplierId}
          size="sm"
          variant={s.supplierId === selectedId ? 'default' : 'outline'}
          onClick={() => onSelect(s.supplierId)}
        >
          {supplierChipLabel(s)}
        </Button>
      ))}
    </div>
  );
}
