'use client';

import type { StockPolicyDto } from '@/lib/types/dto/matching';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

interface StockPolicySectionProps {
  value: StockPolicyDto;
  onChange: (policy: StockPolicyDto) => void;
}

export function StockPolicySection({ value, onChange }: StockPolicySectionProps) {
  const set = (key: keyof StockPolicyDto) => (checked: boolean) => {
    onChange({ ...value, [key]: checked });
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">재고 정책</p>
      <div className="space-y-2 rounded-md border p-3">
        <div className="flex items-center gap-2">
          <Checkbox
            id="preStockSellable"
            checked={value.preStockSellable}
            onCheckedChange={(c) => set('preStockSellable')(!!c)}
          />
          <Label htmlFor="preStockSellable" className="cursor-pointer text-sm">
            선판매 허용 (재고 0이어도 주문 가능)
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="alwaysSellableZeroStock"
            checked={value.alwaysSellableZeroStock}
            onCheckedChange={(c) => set('alwaysSellableZeroStock')(!!c)}
          />
          <Label htmlFor="alwaysSellableZeroStock" className="cursor-pointer text-sm">
            항상 판매 가능 (직배/신상품)
          </Label>
        </div>
      </div>
    </div>
  );
}
