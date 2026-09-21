import { Badge } from '@/components/ui/badge';
import type { SmsGateCategory } from '@/lib/api/domains/sms-gate';

export function CategoryBadge({ category }: { category: SmsGateCategory }) {
  return category === 'MARKETING' ? <Badge>광고</Badge> : <Badge variant="secondary">정보</Badge>;
}
