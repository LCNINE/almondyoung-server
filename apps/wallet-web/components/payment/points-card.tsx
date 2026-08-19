'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Coins } from 'lucide-react';
import { formatAmount } from './utils';

interface Props {
  availablePoints: number;
  maxPoints: number;
  usePoints: boolean;
  pointsAmount: number;
  remainingAmount: number;
  currency: string;
  onToggle: (checked: boolean) => void;
  onAmountChange: (amount: number) => void;
}

export function PointsCard({
  availablePoints,
  maxPoints,
  usePoints,
  pointsAmount,
  remainingAmount,
  currency,
  onToggle,
  onAmountChange,
}: Props) {
  function handleRawChange(raw: string) {
    const parsed = parseInt(raw, 10);
    if (isNaN(parsed) || parsed < 0) {
      onAmountChange(0);
      return;
    }
    onAmountChange(Math.min(parsed, maxPoints));
  }

  return (
    <Card className="border shadow-sm border-border/60">
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Coins className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-semibold">포인트 사용</span>
          </div>
          <span className="text-sm text-muted-foreground">보유: {availablePoints.toLocaleString('ko-KR')}P</span>
        </div>

        {availablePoints === 0 ? (
          <p className="text-sm text-muted-foreground">보유 포인트 없음</p>
        ) : (
          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={usePoints}
                onChange={(e) => onToggle(e.target.checked)}
                className="w-4 h-4 rounded border-border"
              />
              <span className="text-sm">포인트 사용하기</span>
            </label>

            {usePoints && (
              <div className="space-y-2 pl-7">
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={maxPoints}
                    value={pointsAmount}
                    onChange={(e) => handleRawChange(e.target.value)}
                    className="w-32 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                  />
                  <span className="text-sm text-muted-foreground">P</span>
                  <button
                    type="button"
                    onClick={() => onAmountChange(maxPoints)}
                    className="text-xs text-primary hover:underline"
                  >
                    전액 사용
                  </button>
                </div>
                {remainingAmount > 0 ? (
                  <p className="text-xs text-muted-foreground">{formatAmount(remainingAmount, currency)} 추가 결제</p>
                ) : (
                  <p className="text-xs font-medium text-emerald-600">포인트로 전액 결제됩니다</p>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
