'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAdjustStock } from '@/lib/services/inventory';
import type { StockSummaryGroupDto } from '@/lib/types/dto/inventory';

const REASONS = [
  { label: '실사 조정', value: 'STOCKTAKING' },
  { label: '파손', value: 'DAMAGED' },
  { label: '분실', value: 'LOST' },
  { label: '반환', value: 'RETURN' },
  { label: '기타', value: 'OTHER' },
];

const fmt = (n: number) => n.toLocaleString('ko-KR');

type Props = {
  group: StockSummaryGroupDto | null;
  onClose: () => void;
};

/** 셀메이트처럼 상품의 옵션 전체를 한 창에서 조정한다 — 바뀐 옵션마다 조정 API 를 한 번씩 부른다. */
export function AdjustGroupDialog({ group, onClose }: Props) {
  const adjustMutation = useAdjustStock();
  // 입력한 글자를 그대로 들고 있는다 — 숫자로 바로 바꾸면 '-' 만 친 순간 0 이 되어 빼기가 지워진다.
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);

  const rows = (group?.skus ?? []).map((sku) => {
    const key = `${sku.skuId}|${sku.warehouseId}`;
    const text = texts[key] ?? '';
    const parsed = Number.parseInt(text, 10);
    const delta = Number.isNaN(parsed) ? 0 : parsed;

    return { sku, key, text, delta, after: sku.onHandQuantity + delta };
  });
  const changed = rows.filter((row) => row.delta !== 0);
  const negative = rows.some((row) => row.after < 0);

  const setText = (key: string, value: string) =>
    setTexts((prev) => ({ ...prev, [key]: value }));
  const step = (key: string, delta: number, by: number) => {
    const next = delta + by;

    setText(key, next === 0 ? '' : String(next));
  };

  const close = () => {
    setTexts({});
    setReason('');
    onClose();
  };

  const apply = async () => {
    setPending(true);

    let done = 0;

    try {
      for (const row of changed) {
        await adjustMutation.mutateAsync({
          skuId: row.sku.skuId,
          warehouseId: row.sku.warehouseId,
          delta: row.delta,
          reason,
        });
        done += 1;
      }
      toast.success(`옵션 ${done}개의 재고를 조정했습니다.`);
      close();
    } catch {
      toast.error(
        done > 0
          ? `옵션 ${done}개는 조정됐고 나머지는 실패했습니다. 재고가 바뀌었을 수 있으니 숫자를 확인하세요.`
          : '재고 조정에 실패했습니다. 재고가 바뀌었을 수 있으니 숫자를 확인하세요.'
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={!!group} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>재고 조정 — {group?.groupName}</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {group?.skus[0]?.warehouseName} · 증감 칸에 수량을
            입력하세요(줄이려면 -5 처럼).
          </p>
        </DialogHeader>

        <div className="text-sm">
          <div className="grid grid-cols-[1fr_80px_160px_80px] border-b py-2 text-xs font-semibold text-muted-foreground">
            <span>옵션</span>
            <span className="text-right">현재</span>
            <span className="text-center">증감</span>
            <span className="text-right">조정 후</span>
          </div>
          {rows.map((row) => (
            <div
              key={row.key}
              className="grid min-h-[52px] grid-cols-[1fr_80px_160px_80px] items-center border-b"
            >
              <span>{row.sku.skuName}</span>
              <span className="text-right tabular-nums">
                {fmt(row.sku.onHandQuantity)}
              </span>
              <div className="flex items-center justify-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-8"
                  aria-label="1개 줄이기"
                  onClick={() => step(row.key, row.delta, -1)}
                >
                  −
                </Button>
                <Input
                  aria-label={`${row.sku.skuName} 증감 수량`}
                  inputMode="numeric"
                  value={row.text}
                  placeholder="0"
                  className="h-8 w-16 text-center font-bold tabular-nums"
                  onChange={(e) => {
                    const value = e.target.value;

                    if (/^-?\d*$/.test(value)) setText(row.key, value);
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-8"
                  aria-label="1개 늘리기"
                  onClick={() => step(row.key, row.delta, 1)}
                >
                  +
                </Button>
              </div>
              <span
                className={
                  row.after < 0
                    ? 'text-right font-bold tabular-nums text-destructive'
                    : 'text-right font-bold tabular-nums'
                }
              >
                {fmt(row.after)}
              </span>
            </div>
          ))}
        </div>

        {negative && (
          <p className="text-sm text-destructive">
            재고보다 많이 줄일 수 없습니다. 조정 후 수량을 확인하세요.
          </p>
        )}

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          사유
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          >
            <option value="">사유 선택</option>
            {REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={close}>
            취소
          </Button>
          <Button
            type="button"
            disabled={pending || changed.length === 0 || negative || !reason}
            onClick={() => void apply()}
          >
            {changed.length > 0 ? `옵션 ${changed.length}개 조정` : '조정 적용'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
