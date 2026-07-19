'use client';

import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { membershipApi } from '@/lib/api/domains/membership';

export function DunningView() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['dunning-list'],
    queryFn: () => membershipApi.getDunningList(),
    staleTime: 30_000,
  });

  const rows = data?.data ?? [];

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        결제가 실패해 자동 재시도(dunning) 대기 중인 <strong>레거시(CHARGE) 경로</strong> 계약입니다. 스케줄러가 다음
        재시도 시각에 자동으로 재청구합니다. 인보이스 경로 계약의 재시도는 이 큐를 쓰지 않습니다 — [인보이스] 탭의
        &lsquo;결제 실패&rsquo; 상태를 확인하세요.
      </p>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">불러오는 중...</p>
      ) : isError ? (
        <div className="flex flex-col items-center gap-2 rounded-md border py-8">
          <p className="text-sm text-destructive">목록을 불러오지 못했습니다.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            다시 시도
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">재시도 대기 중인 계약이 없습니다.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-muted-foreground">
                <th className="p-2">계약 ID</th>
                <th className="p-2">회원 ID</th>
                <th className="p-2">재시도</th>
                <th className="p-2">다음 재시도</th>
                <th className="p-2">마지막 오류</th>
                <th className="p-2">등록일</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const exhausted = r.attempts >= r.maxAttempts;
                return (
                  <tr key={r.contractId} className="border-b last:border-0">
                    <td className="p-2 font-mono text-xs">{r.contractId.slice(0, 8)}…</td>
                    <td className="p-2 font-mono text-xs">{r.userId.slice(0, 10)}</td>
                    <td className="p-2">
                      <Badge variant={exhausted ? 'destructive' : 'secondary'}>
                        {r.attempts}/{r.maxAttempts}
                      </Badge>
                    </td>
                    <td className="p-2">{new Date(r.nextRetryAt).toLocaleString('ko-KR')}</td>
                    <td className="p-2 text-xs text-destructive" title={r.lastErrorMessage ?? undefined}>
                      {r.lastErrorCode ?? '-'}
                    </td>
                    <td className="p-2 text-xs text-muted-foreground">
                      {new Date(r.createdAt).toLocaleDateString('ko-KR')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
