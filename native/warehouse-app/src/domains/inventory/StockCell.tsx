import { cn } from '../../core/design/cn';
import type { SkuSearchItem } from './types';

/** 재고 3-상태: 품절(0) / 부족(≤안전재고, 안전재고>0) / 정상. */
export function StockCell({ item }: { item: SkuSearchItem }) {
  const stock = item.currentStock;
  const isOut = stock === 0;
  const isLow = !isOut && item.safetyStock > 0 && stock <= item.safetyStock;

  return (
    <div className="text-right tabular-nums">
      <span
        className={cn(
          'font-medium',
          isOut ? 'text-[#aa4037]' : isLow ? 'text-[#9a681c]' : 'text-[#27272a]'
        )}
      >
        {stock}
      </span>
      {isOut && <span className="ml-1 text-xs text-[#aa4037]">품절</span>}
      {isLow && <span className="ml-1 text-xs text-[#9a681c]">부족</span>}
    </div>
  );
}
