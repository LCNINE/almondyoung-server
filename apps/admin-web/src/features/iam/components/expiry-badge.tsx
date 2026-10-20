import { Badge } from '@/components/ui/badge';

const DAY = 24 * 60 * 60 * 1000;
const kst = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: '2-digit',
  day: '2-digit',
});

/** 역할 종료일 — 14일 이내면 주황, 지났으면 «만료됨». 무기한이면 그리지 않는다. */
export function ExpiryBadge({
  expiresAt,
  expired,
  now = Date.now(),
}: {
  expiresAt: string | null;
  expired?: boolean;
  now?: number;
}) {
  if (!expiresAt) return null;
  const end = new Date(expiresAt).getTime();
  if (expired || end <= now) return <Badge variant="secondary">만료됨</Badge>;
  const soon = end - now <= 14 * DAY;
  return (
    <Badge
      variant="outline"
      className={soon ? 'border-orange-400 text-orange-700' : undefined}
      title={soon ? '14일 안에 끝나는 역할' : undefined}
    >
      ~{kst.format(new Date(expiresAt))}
    </Badge>
  );
}
