'use client';

import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { membershipApi } from '@/lib/api/domains/membership';
import { AgreementCleanupItem } from '@/lib/types/dto/membership';

/**
 * 해지가 끝났는데 **은행에 효성 CMS 자동이체 약정이 남아 있는** 계약.
 *
 * 재청구는 DB 플래그(autoRenewal=false + nextBillingDate=null)로 이미 막혀 있어 당장 돈이 나가진
 * 않는다. 그래도 방치하면 해지한 고객 계좌에 자동이체 등록이 그대로 남아 민원이 된다.
 * 특히 `포기` 는 스케줄러가 7일 뒤 **재시도를 멈춘** 상태라, 이 화면이 없으면 아무도 모른 채 영원히
 * 남는다(지금까지는 서버 로그뿐이었다).
 */
const STATE_LABEL: Record<
  AgreementCleanupItem['state'],
  { label: string; variant: 'destructive' | 'secondary' | 'outline'; hint: string }
> = {
  AGREEMENT_REVOKE_ABANDONED: {
    label: '포기 — 수동 처리 필요',
    variant: 'destructive',
    hint: '7일 넘게 정리되지 않아 자동 재시도를 멈췄습니다. 효성에서 직접 회원삭제해야 약정이 끊깁니다.',
  },
  AGREEMENT_REVOKE_PENDING: {
    label: '재시도 중',
    variant: 'secondary',
    hint: '매시간 자동으로 재시도합니다. 7일이 지나면 포기로 확정됩니다.',
  },
  AGREEMENT_REVOKE_DEFERRED: {
    label: '수금 대기(보류)',
    variant: 'outline',
    hint: '이용 종료일까지 남은 출금이 있어 약정을 아직 지우지 않습니다. 종료일이 지나면 자동으로 정리됩니다.',
  },
};

export function AgreementCleanupView() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['agreement-cleanup'],
    queryFn: () => membershipApi.getAgreementCleanupQueue(),
    staleTime: 30_000,
  });

  const rows = data?.data ?? [];
  const abandoned = rows.filter((r) => r.state === 'AGREEMENT_REVOKE_ABANDONED').length;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        해지가 끝났는데 은행에 효성 자동이체 약정이 남아 있는 계약입니다. 재청구는 이미 막혀 있지만,
        고객 계좌의 자동이체 등록은 <strong>효성 회원삭제</strong>로만 끊깁니다.
      </p>
      {abandoned > 0 && (
        <p
          className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          data-testid="agreement-cleanup-abandoned"
        >
          자동 재시도를 멈춘 건이 {abandoned}건 있습니다. 사람이 처리하지 않으면 그대로 남습니다.
        </p>
      )}

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
        <p className="text-sm text-muted-foreground">정리가 남은 자동이체 약정이 없습니다.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-muted-foreground">
                <th className="p-2">상태</th>
                <th className="p-2">계약 ID</th>
                <th className="p-2">회원 ID</th>
                <th className="p-2">경로</th>
                <th className="p-2">해지일</th>
                <th className="p-2">이 상태가 된 시각</th>
                <th className="p-2">정리 가능일</th>
                <th className="p-2">막힌 사유</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const badge = STATE_LABEL[r.state] ?? {
                  label: r.state,
                  variant: 'outline' as const,
                  hint: '',
                };
                return (
                  <tr key={r.contractId} className="border-b last:border-0">
                    <td className="p-2" title={badge.hint}>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </td>
                    <td className="p-2 font-mono text-xs" title={r.contractId}>
                      {r.contractId.slice(0, 8)}…
                    </td>
                    <td className="p-2 font-mono text-xs" title={r.userId}>
                      {r.userId.slice(0, 10)}
                    </td>
                    <td className="p-2 text-xs">{r.billingPath ?? '-'}</td>
                    <td className="p-2 text-xs">
                      {r.cancelledAt ? new Date(r.cancelledAt).toLocaleDateString('ko-KR') : '-'}
                    </td>
                    <td className="p-2 text-xs">{new Date(r.since).toLocaleString('ko-KR')}</td>
                    <td className="p-2 text-xs">{r.notBefore ?? '-'}</td>
                    <td className="p-2 text-xs text-destructive" title={r.reason ?? undefined}>
                      {r.reason
                        ? `${r.reason.slice(0, 40)}${r.reason.length > 40 ? '…' : ''}`
                        : '-'}
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
