'use client';

import { CheckIcon, MinusIcon } from 'lucide-react';

type ReviewCommentStatusCellProps = {
  hasComment: boolean | null | undefined;
};

export function ReviewCommentStatusCell({
  hasComment,
}: ReviewCommentStatusCellProps) {
  if (hasComment) {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-600">
        <CheckIcon className="h-4 w-4" />
        작성됨
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <MinusIcon className="h-4 w-4" />
      미작성
    </span>
  );
}
