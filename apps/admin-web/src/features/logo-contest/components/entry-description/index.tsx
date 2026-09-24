'use client';

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export function EntryDescription({
  description,
}: {
  description: string | null;
}) {
  if (!description) {
    return <span className="text-muted-foreground">-</span>;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="line-clamp-2 max-w-[240px] cursor-help text-sm">
          {description}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm whitespace-pre-wrap">
        {description}
      </TooltipContent>
    </Tooltip>
  );
}
