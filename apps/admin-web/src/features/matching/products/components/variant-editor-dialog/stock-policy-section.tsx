'use client';

import type { StockPolicyDto } from '@/lib/types/dto/matching';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toLocalDateString } from '@/lib/utils/date';

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
      comingSoonDate: null,
    });
  };

  const setComingSoon = (checked: boolean) => {
    onChange({
      ...value,
      availabilityOverride: checked ? 'coming_soon' : null,
      comingSoonDate: checked ? value.comingSoonDate : null,
    });
  };

  const isComingSoon = value.availabilityOverride === 'coming_soon';
  const today = toLocalDateString(new Date());
  const isPastDate = Boolean(
    value.comingSoonDate && value.comingSoonDate < today
  );

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
        <div className="flex items-center gap-2">
          <Checkbox
            id="comingSoon"
            checked={isComingSoon}
            onCheckedChange={(c) => setComingSoon(!!c)}
          />
          <Label htmlFor="comingSoon" className="text-sm cursor-pointer">
            출시 예정 (입고되면 자동 판매·자동 해제)
          </Label>
        </div>
        {isComingSoon && (
          <div className="pt-1 pl-6 space-y-1">
            <Label
              htmlFor="comingSoonDate"
              className="text-xs text-muted-foreground"
            >
              출시일 (선택) — 비우면 &quot;곧 출시 예정&quot;으로 표시
            </Label>
            <Input
              id="comingSoonDate"
              type="date"
              min={today}
              className="h-8 w-44 cursor-pointer"
              value={value.comingSoonDate ?? ''}
              onClick={(e) => {
                // 캘린더 아이콘을 눌러 이미 열린 뒤라면 InvalidStateError 를 던진다.
                try {
                  e.currentTarget.showPicker?.();
                } catch {
                  /* 이미 열려 있음 */
                }
              }}
              onChange={(e) =>
                onChange({ ...value, comingSoonDate: e.target.value || null })
              }
            />
            {isPastDate ? (
              <p role="alert" className="text-xs font-medium text-destructive">
                오늘({today})보다 이전 날짜입니다. 고객에게는 날짜 없이 &quot;곧
                출시 예정&quot;으로만 표시됩니다.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                날짜는 안내 문구일 뿐이며 판매를 열지 않습니다. 판매는 입고
                시점에 시작됩니다.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
