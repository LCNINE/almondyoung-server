'use client';

import { Badge } from '@/components/ui/badge';
import { QuestionStatus, STATUS_LABELS } from '@/lib/types/dto/qna';

const statusConfig: Record<
  QuestionStatus,
  {
    label: string;
    variant: 'default' | 'secondary' | 'destructive' | 'outline';
  }
> = {
  active: { label: STATUS_LABELS.active, variant: 'secondary' },
  answered: { label: STATUS_LABELS.answered, variant: 'default' },
};

type QnaStatusCellProps = {
  status: string | null | undefined;
  deletedAt?: string | null;
};

export function QnaStatusCell({ status, deletedAt }: QnaStatusCellProps) {
  if (deletedAt) {
    return <Badge variant="destructive">{STATUS_LABELS.deleted}</Badge>;
  }
  if (!status) return <span className="text-muted-foreground">-</span>;
  const config = statusConfig[status as QuestionStatus];
  return (
    <Badge variant={config?.variant ?? 'outline'}>
      {config?.label ?? status}
    </Badge>
  );
}
