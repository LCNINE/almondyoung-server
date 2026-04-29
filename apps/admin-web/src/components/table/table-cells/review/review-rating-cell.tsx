'use client';

import { StarIcon } from 'lucide-react';

type ReviewRatingCellProps = {
  value: number | null | undefined;
};

export function ReviewRatingCell({ value }: ReviewRatingCellProps) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">-</span>;
  }

  const rating = Math.max(0, Math.min(5, Math.round(value)));

  return (
    <div className="flex items-center gap-1" aria-label={`별점 ${rating}점`}>
      {Array.from({ length: 5 }).map((_, index) => (
        <StarIcon
          key={index}
          className={
            index < rating
              ? 'h-4 w-4 fill-yellow-400 text-yellow-400'
              : 'h-4 w-4 text-muted-foreground/40'
          }
        />
      ))}
      <span className="ml-1 text-sm text-muted-foreground">{rating}</span>
    </div>
  );
}
