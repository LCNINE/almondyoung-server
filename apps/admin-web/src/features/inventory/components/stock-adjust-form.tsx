'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DialogFooter } from '@/components/ui/dialog';
import { cn } from '@/lib/utils/ui';
import { Minus, Plus } from 'lucide-react';

const ADJUST_REASONS = [
  { label: '분실', value: 'LOST' },
  { label: '파손', value: 'DAMAGED' },
  { label: '반환', value: 'RETURN' },
  { label: '실사 조정', value: 'STOCKTAKING' },
  { label: '기타', value: 'OTHER' },
];

type Direction = 'increase' | 'decrease';

type Props = {
  /** 현재 재고. null이면 아직 대상(SKU/창고) 미선택 → 미리보기 대신 안내 */
  currentQuantity: number | null;
  pending: boolean;
  /** 대상 미선택 등으로 입력 자체를 막을 때 */
  disabled?: boolean;
  /** 값이 바뀌면 내부 입력 상태를 초기화 (대상 전환/재오픈 시) */
  resetKey?: string;
  onSubmit: (delta: number, reason: string) => void;
  onCancel: () => void;
};

/**
 * 재고 조정 입력 폼
 */
export function StockAdjustForm({
  currentQuantity,
  pending,
  disabled,
  resetKey,
  onSubmit,
  onCancel,
}: Props) {
  const [direction, setDirection] = useState<Direction | null>(null);
  const [quantity, setQuantity] = useState<number | ''>('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    setDirection(null);
    setQuantity('');
    setReason('');
  }, [resetKey]);

  const qty = quantity === '' ? 0 : quantity;
  const delta = direction === 'decrease' ? -qty : qty;
  const nextQuantity = currentQuantity != null ? currentQuantity + delta : null;
  const wouldGoNegative = nextQuantity != null && nextQuantity < 0;

  const canSubmit =
    !pending &&
    !disabled &&
    !!direction &&
    qty > 0 &&
    !!reason &&
    !wouldGoNegative;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>조정 방향</Label>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={direction === 'increase' ? 'default' : 'outline'}
            disabled={disabled}
            onClick={() => setDirection('increase')}
          >
            <Plus data-icon="inline-start" />
            증가 (입고)
          </Button>
          <Button
            type="button"
            variant={direction === 'decrease' ? 'default' : 'outline'}
            disabled={disabled}
            onClick={() => setDirection('decrease')}
          >
            <Minus data-icon="inline-start" />
            감소 (출고)
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="stock-adjust-qty">수량</Label>
        <Input
          id="stock-adjust-qty"
          type="number"
          min={1}
          inputMode="numeric"
          value={quantity}
          disabled={disabled}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') return setQuantity('');
            const n = Math.floor(Number(raw));
            setQuantity(Number.isFinite(n) && n > 0 ? n : '');
          }}
          placeholder="조정할 수량 (양수만)"
        />
      </div>

      <div className="px-3 py-2 text-sm border rounded-md bg-muted/40">
        {currentQuantity == null ? (
          <span className="text-muted-foreground">
            대상을 선택하면 현재 수량이 표시됩니다.
          </span>
        ) : direction && qty > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground">현재</span>
            <b className="text-foreground">
              {currentQuantity.toLocaleString('ko-KR')}
            </b>
            <span className="text-muted-foreground">→ 조정 후</span>
            <b
              className={cn(
                wouldGoNegative
                  ? 'text-destructive'
                  : direction === 'increase'
                    ? 'text-emerald-600'
                    : 'text-red-600'
              )}
            >
              {nextQuantity!.toLocaleString('ko-KR')}
            </b>
            <span
              className={cn(
                'text-xs',
                direction === 'increase' ? 'text-emerald-600' : 'text-red-600'
              )}
            >
              ({delta > 0 ? '+' : ''}
              {delta.toLocaleString('ko-KR')})
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground">
            현재 수량{' '}
            <b className="text-foreground">
              {currentQuantity.toLocaleString('ko-KR')}
            </b>
          </span>
        )}
        {wouldGoNegative && (
          <p className="mt-1 text-destructive">
            재고가 음수가 될 수 없습니다. 감소 수량을 확인하세요.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="stock-adjust-reason">사유</Label>
        <select
          id="stock-adjust-reason"
          value={reason}
          disabled={disabled}
          onChange={(e) => setReason(e.target.value)}
          className="flex w-full px-3 py-1 text-sm transition-colors bg-transparent border rounded-md shadow-sm h-9 border-input placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="">사유 선택</option>
          {ADJUST_REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          취소
        </Button>
        <Button
          type="button"
          disabled={!canSubmit}
          variant={direction === 'decrease' ? 'destructive' : 'default'}
          onClick={() => onSubmit(delta, reason)}
        >
          {pending
            ? '조정 중...'
            : direction === 'decrease'
              ? '감소 적용'
              : '증가 적용'}
        </Button>
      </DialogFooter>
    </div>
  );
}
