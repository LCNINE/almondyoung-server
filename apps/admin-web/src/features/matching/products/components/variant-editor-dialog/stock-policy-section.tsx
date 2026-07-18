'use client';

import type { StockPolicyDto } from '@/lib/types/dto/matching';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

interface StockPolicySectionProps {
  value: StockPolicyDto;
  onChange: (policy: StockPolicyDto) => void;
}

export function StockPolicySection({
  value,
  onChange,
}: StockPolicySectionProps) {
  const set =
    (key: 'preStockSellable' | 'alwaysSellableZeroStock') =>
    (checked: boolean) => {
      onChange({ ...value, [key]: checked });
    };

  const setManualOutOfStock = (checked: boolean) => {
    onChange({
      ...value,
      availabilityOverride: checked ? 'manual_out_of_stock' : null,
    });
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">재고 정책</p>
      <div className="p-3 space-y-2 border rounded-md">
        <div className="flex items-center gap-2">
          <Checkbox
            id="preStockSellable"
            checked={value.preStockSellable}
            onCheckedChange={(c) => set('preStockSellable')(!!c)}
          />
          <Label htmlFor="preStockSellable" className="text-sm cursor-pointer">
            선판매 허용 (재고 0이어도 주문 가능)
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="alwaysSellableZeroStock"
            checked={value.alwaysSellableZeroStock}
            onCheckedChange={(c) => set('alwaysSellableZeroStock')(!!c)}
          />
          <Label
            htmlFor="alwaysSellableZeroStock"
            className="text-sm cursor-pointer"
          >
            항상 판매 가능 (직배/신상품)
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="manualOutOfStock"
            checked={value.availabilityOverride === 'manual_out_of_stock'}
            onCheckedChange={(c) => setManualOutOfStock(!!c)}
          />
          <Label htmlFor="manualOutOfStock" className="text-sm cursor-pointer">
            수동 품절 (노출 유지, 판매 재고 0)
          </Label>
        </div>
      </div>
    </div>
  );
}
