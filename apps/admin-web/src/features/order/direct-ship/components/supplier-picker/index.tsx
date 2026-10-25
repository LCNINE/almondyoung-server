'use client';

import { Button } from '@/components/ui/button';
import type { SupplierQueueSummary } from '@/lib/types/dto/fulfillment';
import { supplierChipLabel } from '../../lib/supplier-picker';

interface Props {
  /** 열린 상자 요약 + 열린 상자 없는 직배 입점사(0) — `supplierPickerView` 가 만든다 */
  chips: SupplierQueueSummary[];
  selectedId: string | null;
  onSelect: (supplierId: string) => void;
}

/** 탭 위 한 줄 — 다섯 탭 중 알릴 취소를 뺀 넷이 같이 쓴다(N12) */
export function SupplierPicker({ chips, selectedId, onSelect }: Props) {
  // 직배 입점사도 열린 상자도 없을 때만 — 다 발송한 입점사는 0 칩으로 남는다
  if (chips.length === 0) {
    return <p className="px-4 pt-2 text-sm text-muted-foreground">열린 직배 상자가 없습니다.</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5 px-4 pt-2">
      {chips.map((s) => (
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
