'use client';

import { SectionCard } from '@/components/payment/section-card';

interface Props {
  availablePoints: number;
  maxPoints: number;
  pointsAmount: number;
  onAmountChange: (amount: number) => void;
}

export function PointsCard({ availablePoints, maxPoints, pointsAmount, onAmountChange }: Props) {
  function handleRawChange(raw: string) {
    const parsed = parseInt(raw, 10);
    if (isNaN(parsed) || parsed < 0) {
      onAmountChange(0);
      return;
    }
    onAmountChange(Math.min(parsed, maxPoints));
  }

  return (
    <SectionCard
      title="포인트 보유"
      headerRight={
        <span className="text-[15px] font-bold text-gray-900 lg:text-lg">
          {(availablePoints - pointsAmount).toLocaleString('ko-KR')}P
        </span>
      }
    >
      {availablePoints === 0 ? (
        <p className="text-[14px] text-gray-400 lg:text-sm">보유 포인트 없음</p>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <input
                type="number"
                min={0}
                max={maxPoints}
                value={pointsAmount === 0 ? '' : pointsAmount}
                placeholder="0"
                onChange={(e) => handleRawChange(e.target.value)}
                aria-label="사용할 포인트"
                className="h-11 w-full rounded-md border border-gray-300 bg-white pr-8 pl-3 text-right text-[15px] tabular-nums outline-none focus:border-gray-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <span className="absolute top-1/2 right-3 -translate-y-1/2 text-[14px] text-gray-500">P</span>
            </div>
            {maxPoints > 0 && (
              <button
                type="button"
                onClick={() => onAmountChange(maxPoints)}
                className="h-11 shrink-0 rounded-md bg-gray-100 px-4 text-[14px] font-medium text-gray-700 transition-colors hover:bg-gray-200"
              >
                전액 사용
              </button>
            )}
          </div>
        </>
      )}
    </SectionCard>
  );
}
