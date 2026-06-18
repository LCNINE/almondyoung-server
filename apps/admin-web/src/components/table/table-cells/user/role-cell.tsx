import { Badge } from '@/components/ui/badge';
import { PlaceholderCell } from '../common/placeholder-cell';

// 우선순위(높은 권한 → 낮은 권한) 순으로 정렬해 표시한다.
const ROLE_ORDER = ['admin', 'master', 'user'] as const;
const ROLE_LABELS: Record<string, string> = {
  master: '슈퍼계정',
  admin: '관리자',
  user: '일반회원',
};

type RoleCellProps = {
  roles: string[] | null | undefined;
};

export const RoleCell = ({ roles }: RoleCellProps) => {
  const known = ROLE_ORDER.filter((role) => roles?.includes(role));
  // 역할이 없거나 알 수 없는 값만 있는 경우 일반회원으로 취급한다.
  const labels = known.length > 0 ? known.map((role) => ROLE_LABELS[role]) : ['일반회원'];

  if (labels.length === 0) return <PlaceholderCell />;

  return (
    <div className="flex flex-wrap gap-1">
      {labels.map((label) => (
        <Badge key={label} variant="secondary">
          {label}
        </Badge>
      ))}
    </div>
  );
};
