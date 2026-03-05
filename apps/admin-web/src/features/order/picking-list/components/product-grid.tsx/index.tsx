/** @format */

'use client';

import { cn } from '@/lib/utils/ui';

interface GridCell {
  id: number;
  value: number | null;
  isHighlighted: boolean;
}

const gridData: GridCell[] = [
  { id: 1, value: 50, isHighlighted: true },
  { id: 2, value: null, isHighlighted: false },
  { id: 3, value: null, isHighlighted: false },
  { id: 4, value: 50, isHighlighted: true },
  { id: 5, value: null, isHighlighted: false },
  { id: 6, value: null, isHighlighted: false },
  { id: 7, value: 100, isHighlighted: true },
  { id: 8, value: null, isHighlighted: false },
  { id: 9, value: null, isHighlighted: false },
  { id: 10, value: null, isHighlighted: false },
  { id: 11, value: 250, isHighlighted: true },
  { id: 12, value: null, isHighlighted: false },
  { id: 13, value: null, isHighlighted: false },
  { id: 14, value: 150, isHighlighted: true },
  { id: 15, value: null, isHighlighted: false },
  { id: 16, value: null, isHighlighted: false },
  { id: 17, value: null, isHighlighted: false },
  { id: 18, value: null, isHighlighted: false },
  { id: 19, value: null, isHighlighted: false },
  { id: 20, value: null, isHighlighted: false },
];

export default function ProductGrid() {
  return (
    <div className="grid grid-cols-5 gap-2">
      {gridData.map((cell) => (
        <div
          key={cell.id}
          className={cn(
            'relative flex aspect-square items-center justify-center rounded-md border-2 transition-colors',
            cell.isHighlighted
              ? 'border-primary bg-[#2F31A8] text-white'
              : 'border-border bg-white text-muted-foreground'
          )}
        >
          {/* 라벨 */}
          <div
            className={cn(
              'absolute top-0 left-0 right-0 flex justify-center border-b text-xs font-medium pt-1',
              cell.isHighlighted
                ? 'bg-[#2F31A8] text-white border-transparent'
                : 'bg-[#D9D9D9] text-gray-600'
            )}
          >
            {cell.id}
          </div>

          {/* 값  */}
          {cell.value && (
            <span className="text-2xl font-bold">{cell.value}</span>
          )}
        </div>
      ))}
    </div>
  );
}
