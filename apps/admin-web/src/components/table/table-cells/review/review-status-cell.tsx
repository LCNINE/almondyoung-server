'use client';

import { Badge } from '@/components/ui/badge';
import { ReviewStatus, STATUS_LABELS } from '@/lib/types/dto/review';

const statusConfig: Record<
  ReviewStatus,
  {
    label: string;
    variant: 'default' | 'secondary' | 'destructive' | 'outline';
  }
> = {
  active: { label: STATUS_LABELS.active, variant: 'default' },
  hidden: { label: STATUS_LABELS.hidden, variant: 'secondary' },
  deleted: { label: STATUS_LABELS.deleted, variant: 'destructive' },
};

type ReviewStatusCellProps = {
  value: string | null | undefined;
};

export function ReviewStatusCell({ value }: ReviewStatusCellProps) {
  if (!value) return <span className="text-muted-foreground">-</span>;
  const config = statusConfig[value as ReviewStatus];
  return (
    <Badge variant={config?.variant ?? 'outline'}>
      {config?.label ?? value}
    </Badge>
  );
}
