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
  deleted: { label: STATUS_LABELS.deleted, variant: 'destructive' },
};

type QnaStatusCellProps = {
  value: string | null | undefined;
};

export function QnaStatusCell({ value }: QnaStatusCellProps) {
  if (!value) return <span className="text-muted-foreground">-</span>;
  const config = statusConfig[value as QuestionStatus];
  return (
    <Badge variant={config?.variant ?? 'outline'}>
      {config?.label ?? value}
    </Badge>
  );
}
