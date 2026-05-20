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
};

type ReviewStatusCellProps = {
  status: string | null | undefined;
  deletedAt?: string | null;
};

export function ReviewStatusCell({ status, deletedAt }: ReviewStatusCellProps) {
  if (deletedAt) {
    return <Badge variant="destructive">{STATUS_LABELS.deleted}</Badge>;
  }
  if (!status) return <span className="text-muted-foreground">-</span>;
  const config = statusConfig[status as ReviewStatus];
  return (
    <Badge variant={config?.variant ?? 'outline'}>
      {config?.label ?? status}
    </Badge>
  );
}
