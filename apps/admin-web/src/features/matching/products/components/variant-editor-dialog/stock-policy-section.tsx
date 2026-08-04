'use client';

import type { MatchingStrategy, StockPolicyDto } from '@/lib/types/dto/matching';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toLocalDateString } from '@/lib/utils/date';
import {
  COMING_SOON_MANUAL_CLEAR_HINT,
  willComingSoonClearOnStock,
} from '@/lib/services/matching';

interface StockPolicySectionProps {
  value: StockPolicyDto;
  strategy?: MatchingStrategy | null;
  onChange: (policy: StockPolicyDto) => void;
}

export function StockPolicySection({
  value,
  strategy,
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
  const clearsOnStock = willComingSoonClearOnStock(value, strategy);

  // 출시예정 중에는 이 두 플래그가 계산기에서 무시되므로 "지금 적용되는 설정" 자리에 두면
  // 거짓말이 된다. 그렇다고 잠가버리면 입고 후 어떻게 될지 볼 수도 고칠 수도 없다.
  // 그래서 잠그는 대신 출시예정 하위 "입고 후 적용할 정책" 으로 자리를 옮긴다 — 값은 같은
  // 컬럼 하나 그대로라 UI 가 둘로 갈라지지 않는다.
  const sellFlags = (
    <>
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
    </>
  );

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">재고 정책</p>
      <div className="p-3 space-y-2 border rounded-md">
        {!isComingSoon && sellFlags}
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
            {clearsOnStock
              ? '출시 예정 (입고되면 자동 판매·자동 해제)'
              : '출시 예정 (자동 해제 안 됨 — 직접 풀어야 함)'}
          </Label>
        </div>
        {isComingSoon && !clearsOnStock && (
          <p role="alert" className="pl-6 text-xs font-medium text-destructive">
            {COMING_SOON_MANUAL_CLEAR_HINT}
          </p>
        )}
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

            <div className="pt-2 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                {clearsOnStock
                  ? '입고 후 적용할 정책'
                  : '출시 예정 해제 후 적용할 정책'}
              </p>
              {sellFlags}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
