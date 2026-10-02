import { Badge } from '@/components/ui/badge';
import type { AlimtalkTemplateStatus } from '@/lib/api/domains/alimtalk';
import { STATUS_LABEL } from '../lib/alimtalk';

const VARIANT: Record<
  AlimtalkTemplateStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  TSC01: 'outline',
  TSC02: 'secondary',
  TSC03: 'default',
  TSC04: 'destructive',
};

export function StatusBadge({
  status,
  label,
}: {
  status: AlimtalkTemplateStatus;
  label?: string;
}) {
  return (
    <Badge variant={VARIANT[status] ?? 'outline'}>
      {STATUS_LABEL[status] ?? label ?? status}
    </Badge>
  );
}
