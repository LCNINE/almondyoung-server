'use client';

import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils/ui';
import {
  DISCOUNT_CHOICES,
  TIMES_CHOICES,
  priceFor,
  won,
  type DiscountPct,
  type PickedAxes,
} from './publish-model';

export interface OptionRow {
  key: string;
  label: string;
  /** undefined 면 견적을 부르는 중, null 이면 견적 실패 */
  cost: number | null | undefined;
  price: number;
  memberPrice: number | null;
  on: boolean;
  edited: boolean;
}

export type AxisName = keyof PickedAxes;

interface AxisChoice {
  value: number;
  label: string;
}

interface StepOptionsProps {
  axes: Record<AxisName, AxisChoice[]>;
  picked: PickedAxes;
  onToggleAxis: (axis: AxisName, value: number) => void;
  requiredAwkLabels: string[];
  times: number;
  onTimes: (times: number) => void;
  discountPct: DiscountPct;
  onDiscount: (pct: DiscountPct) => void;
  rows: OptionRow[];
  onToggleRow: (key: string, on: boolean) => void;
  onPriceChange: (key: string, price: number) => void;
  onRetryFailed: () => void;
}

function Chip({ on, onClick, children }: { on: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'rounded-full border px-3.5 py-1.5 text-sm',
        on ? 'border-foreground bg-foreground text-background' : 'bg-background hover:bg-muted'
      )}
    >
      {children}
    </button>
  );
}

const AXIS_TITLES: Record<AxisName, string> = { papers: '용지', colors: '면', qtys: '수량' };

export function StepOptions({
  axes,
  picked,
  onToggleAxis,
  requiredAwkLabels,
  times,
  onTimes,
  discountPct,
  onDiscount,
  rows,
  onToggleRow,
  onPriceChange,
  onRetryFailed,
}: StepOptionsProps) {
  const custom = !TIMES_CHOICES.some((t) => t === times);
  const [customInput, setCustomInput] = useState(custom ? String(times) : '');
  const sample = rows.find((r) => typeof r.cost === 'number');
  const kept = rows.filter((r) => r.edited).length;
  const failed = rows.filter((r) => r.cost === null).length;

  return (
    <div className="flex flex-col gap-4 text-sm">
      {(['papers', 'colors', 'qtys'] as const).map((axis) => (
        <div key={axis}>
          <div className="mb-2 font-medium">{AXIS_TITLES[axis]}</div>
          <div className="flex flex-wrap gap-2">
            {axes[axis].map((choice) => (
              <Chip
                key={choice.value}
                on={picked[axis].includes(choice.value)}
                onClick={() => onToggleAxis(axis, choice.value)}
              >
                {choice.label}
              </Chip>
            ))}
          </div>
        </div>
      ))}

      {requiredAwkLabels.length > 0 && (
        <p className="text-muted-foreground text-xs">필수 후가공은 {requiredAwkLabels.join(', ')}로 골라 뒀어요.</p>
      )}

      <div className="bg-muted/50 rounded-lg px-3 py-2.5">
        {rows.length}개 조합이 만들어져요. 와우프레스가 만들 수 없는 조합은 처음부터 빼 뒀어요.
      </div>

      <div>
        <div className="mb-2 flex items-baseline gap-2 font-medium">
          판매가 <span className="text-muted-foreground text-xs font-normal">원가의 몇 배로 팔까요?</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {TIMES_CHOICES.map((t) => (
            <Chip key={t} on={times === t} onClick={() => onTimes(t)}>
              {t}배
            </Chip>
          ))}
          <span
            className={cn(
              'flex items-center rounded-full border px-3.5 py-1.5',
              custom ? 'border-foreground bg-foreground text-background' : 'bg-background'
            )}
          >
            직접
            <input
              type="number"
              min={1}
              step={0.1}
              value={customInput}
              placeholder="1.8"
              aria-label="직접 정한 배수"
              className="w-12 border-0 bg-transparent text-right outline-none"
              onChange={(e) => {
                setCustomInput(e.target.value);
                const value = Number(e.target.value);
                if (value >= 1) onTimes(value);
              }}
            />
            배
          </span>
        </div>
        {sample && typeof sample.cost === 'number' && (
          <div className="bg-muted/50 mt-2.5 rounded-lg px-3 py-2.5">
            예) {sample.label}: 원가 {won(sample.cost)} → 판매가 <b>{won(priceFor(sample.cost, times))}</b> (100원
            단위로 올림)
            {kept > 0 && <div className="text-muted-foreground text-xs">직접 고친 {kept}칸은 그대로 뒀어요</div>}
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-baseline gap-2 font-medium">
          멤버십 할인 <span className="text-muted-foreground text-xs font-normal">멤버십 회원은 판매가에서 이만큼 빼 줘요</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {DISCOUNT_CHOICES.map((pct) => (
            <Chip key={pct} on={discountPct === pct} onClick={() => onDiscount(pct)}>
              {pct === 0 ? '할인 없음' : `${pct}% 할인`}
            </Chip>
          ))}
        </div>
      </div>

      {failed > 0 && (
        <div className="text-destructive flex items-center gap-2">
          견적을 불러오지 못한 조합이 {failed}개 있어요.
          <Button variant="outline" size="sm" onClick={onRetryFailed}>
            견적 다시 불러오기
          </Button>
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>조합</TableHead>
            <TableHead className="text-right">원가</TableHead>
            <TableHead className="text-right">판매가</TableHead>
            {discountPct > 0 && <TableHead className="text-right">멤버십가</TableHead>}
            <TableHead className="text-right">원가의</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const cost = typeof r.cost === 'number' ? r.cost : null;

            return (
              <TableRow key={r.key} className={cn(!r.on && 'text-muted-foreground opacity-60')}>
                <TableCell>
                  <Checkbox
                    checked={r.on}
                    aria-label="이 조합 판매"
                    onCheckedChange={(checked) => onToggleRow(r.key, checked === true)}
                  />
                </TableCell>
                <TableCell>{r.label}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.cost === undefined ? '불러오는 중…' : cost === null ? <span className="text-destructive">견적 실패</span> : won(cost)}
                </TableCell>
                <TableCell className="text-right">
                  <Input
                    inputMode="numeric"
                    aria-label={`${r.label} 판매가`}
                    className="ml-auto w-28 text-right tabular-nums"
                    value={r.price > 0 ? r.price.toLocaleString('ko-KR') : ''}
                    disabled={cost === null}
                    onChange={(e) => onPriceChange(r.key, Number(e.target.value.replace(/[^0-9]/g, '')) || 0)}
                  />
                  {r.edited && <span className="ml-1 text-[11px] text-blue-600">직접 고침</span>}
                </TableCell>
                {discountPct > 0 && (
                  <TableCell
                    className={cn(
                      'text-right tabular-nums',
                      cost !== null && r.memberPrice !== null && r.memberPrice <= cost && 'text-destructive font-bold'
                    )}
                  >
                    {r.memberPrice !== null && r.price > 0 ? won(r.memberPrice) : '-'}
                  </TableCell>
                )}
                <TableCell
                  className={cn('text-right tabular-nums', cost !== null && r.price <= cost && 'text-destructive font-bold')}
                >
                  {cost ? `${(r.price / cost).toFixed(1)}배` : '-'}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
