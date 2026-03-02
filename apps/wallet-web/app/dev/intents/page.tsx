import Link from 'next/link';
import { desc } from 'drizzle-orm';
import { db, paymentIntents } from '@/lib/wallet-db';
import { IntentSearch } from './IntentSearch';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  CREATED: 'secondary',
  PROCESSING: 'default',
  REQUIRES_ACTION: 'outline',
  SUCCEEDED: 'default',
  FAILED: 'destructive',
  CANCELED: 'outline',
};

export default async function IntentsPage() {
  const recent = await db
    .select()
    .from(paymentIntents)
    .orderBy(desc(paymentIntents.createdAt))
    .limit(20);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Intent 조회</h1>
        <p className="text-sm text-muted-foreground mt-1">
          UUID로 개별 intent를 조회하거나 최근 목록에서 선택하세요.
        </p>
      </div>

      <IntentSearch />

      <div>
        <h2 className="text-sm font-semibold text-muted-foreground mb-2">최근 20건</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">데이터 없음</p>
        ) : (
          <div className="rounded-md border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">ID</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="text-right px-4 py-2 font-medium">Amount</th>
                  <th className="text-left px-4 py-2 font-medium">User</th>
                  <th className="text-left px-4 py-2 font-medium">생성</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((intent, i) => (
                  <tr
                    key={intent.id}
                    className={i % 2 === 0 ? 'bg-background' : 'bg-muted/20'}
                  >
                    <td className="px-4 py-2 font-mono">
                      <Link
                        href={`/dev/intents/${intent.id}`}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        {intent.id.slice(0, 8)}…
                      </Link>
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant={STATUS_VARIANT[intent.status] ?? 'secondary'}>
                        {intent.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {intent.payableAmount.toLocaleString()} {intent.currency}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                      {(intent.userId ?? '-').slice(0, 12)}…
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {formatDistanceToNow(intent.createdAt, { addSuffix: true, locale: ko })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
