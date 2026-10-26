'use client';

import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useClientPage } from './client-pager';
import { membershipApi } from '@/lib/api/domains/membership';
import { useUserNames } from '@/hooks/use-user-names';

const CMS_STATUS_LABEL: Record<string, string> = {
  PENDING: '심사 중',
  REGISTERED: '사용 가능',
  FAILED: '심사 실패',
};

/**
 * 자동이체 계좌는 등록했는데 그 뒤로 가입이 생기지 않은 회원. 고객은 가입까지 끝났다고 믿고 있어서
 * 먼저 문의하지 않으면 드러나지 않는다. 해지 후 계좌만 남긴 회원은 계좌 등록보다 계약이 뒤라 빠진다.
 */
export function SignupMissingView() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['signup-missing'],
    queryFn: () => membershipApi.getSignupMissing(),
    staleTime: 30_000,
  });

  const rows = data?.data ?? [];
  const { pageRows, pager } = useClientPage(rows);
  const userMap = useUserNames(pageRows.map((r) => r.userId));

  return (
    <div className="space-y-3">
      {isLoading ? (
        <p className="text-sm text-muted-foreground">불러오는 중...</p>
      ) : isError ? (
        <div className="flex flex-col items-center gap-2 rounded-md border py-8">
          <p className="text-sm text-destructive">
            목록을 불러오지 못했습니다.
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            다시 시도
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          계좌만 등록하고 가입이 없는 회원이 없습니다.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-muted-foreground">
                <th className="p-2">회원</th>
                <th className="p-2">계좌 심사</th>
                <th className="p-2">계좌 등록 시각</th>
                <th className="p-2">마지막 가입</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => {
                const user = userMap[r.userId];
                return (
                  <tr key={r.userId} className="border-b last:border-0">
                    <td className="p-2" title={r.userId}>
                      {user ? (
                        <>
                          {user.username}{' '}
                          <span className="text-xs text-muted-foreground">
                            ({user.loginId})
                          </span>
                        </>
                      ) : (
                        <span className="font-mono text-xs">
                          {r.userId.slice(0, 10)}
                        </span>
                      )}
                    </td>
                    <td className="p-2">
                      <Badge
                        variant={
                          r.cmsMemberStatus === 'FAILED'
                            ? 'destructive'
                            : 'outline'
                        }
                      >
                        {CMS_STATUS_LABEL[r.cmsMemberStatus] ??
                          r.cmsMemberStatus}
                      </Badge>
                    </td>
                    <td className="p-2 text-xs">
                      {new Date(r.latestAgreementAt).toLocaleString('ko-KR')}
                    </td>
                    <td className="p-2 text-xs">
                      {r.lastContractAt
                        ? new Date(r.lastContractAt).toLocaleDateString('ko-KR')
                        : '없음'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 0 && pager}
    </div>
  );
}
