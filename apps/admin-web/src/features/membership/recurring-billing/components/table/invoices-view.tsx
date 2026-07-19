'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { walletApi } from '@/lib/api/domains/wallet';
import { membershipApi } from '@/lib/api/domains/membership';
import {
  AdminRecurringInvoiceRow,
  AdminRecurringInvoiceStatus,
} from '@/lib/types/dto/wallet';

const PAGE_SIZE = 20;

// 인보이스 상태 → 관리자 표시. 심사 대기(MANDATE_PENDING)는 연체가 아니고,
// PAST_DUE/UNCOLLECTIBLE 만 미수다(ADR-0027 §6).
const STATUS_LABEL: Record<AdminRecurringInvoiceStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  DRAFT: { label: '초안', variant: 'outline' },
  OPEN: { label: '청구 대기', variant: 'secondary' },
  MANDATE_PENDING: { label: '계좌 심사 대기', variant: 'secondary' },
  ATTEMPTING: { label: '출금 진행 중', variant: 'default' },
  PAST_DUE: { label: '결제 실패(재시도 예정)', variant: 'destructive' },
  PAID: { label: '결제 완료', variant: 'default' },
  UNCOLLECTIBLE: { label: '미수 확정', variant: 'destructive' },
  MANDATE_REJECTED: { label: '계좌 심사 거절', variant: 'destructive' },
  VOID: { label: '무효화', variant: 'outline' },
};

const STATUS_FILTER_OPTIONS: { value: '' | AdminRecurringInvoiceStatus; label: string }[] = [
  { value: '', label: '전체' },
  { value: 'OPEN', label: '청구 대기' },
  { value: 'MANDATE_PENDING', label: '계좌 심사 대기' },
  { value: 'ATTEMPTING', label: '출금 진행 중' },
  { value: 'PAST_DUE', label: '결제 실패' },
  { value: 'PAID', label: '결제 완료' },
  { value: 'UNCOLLECTIBLE', label: '미수 확정' },
  { value: 'MANDATE_REJECTED', label: '심사 거절' },
  { value: 'VOID', label: '무효화' },
];

export function RecurringInvoicesView() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  // 요약 카드에서 status 필터를 걸어 진입할 수 있으므로 URL 값으로 초기화한다(미수 지표 딥링크).
  const urlStatus = searchParams.get('status');
  const initialStatus = STATUS_FILTER_OPTIONS.some((o) => o.value === urlStatus)
    ? (urlStatus as AdminRecurringInvoiceStatus)
    : '';
  const [status, setStatus] = useState<'' | AdminRecurringInvoiceStatus>(initialStatus);
  const [searchRef, setSearchRef] = useState('');
  const [appliedRef, setAppliedRef] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['recurring-invoices', status, appliedRef, page],
    queryFn: () =>
      walletApi.listRecurringInvoices({
        page,
        limit: PAGE_SIZE,
        ...(status ? { status } : {}),
        ...(appliedRef ? { subscriberRef: appliedRef } : {}),
      }),
    staleTime: 15_000,
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ['recurring-invoices'] });

  const runDue = useMutation({
    mutationFn: () => walletApi.runDueInvoices(),
    onSuccess: () => {
      invalidate();
      toast.success('만기 인보이스 집행을 실행했습니다.');
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : '집행 실행에 실패했습니다.'),
  });

  const execute = useMutation({
    mutationFn: (id: string) => walletApi.executeInvoice(id),
    onSuccess: () => {
      invalidate();
      toast.success('인보이스를 집행했습니다. 상태가 곧 갱신됩니다.');
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : '집행에 실패했습니다.'),
  });

  // membership 이 자기 멱등키로 wallet 인보이스 권위 상태를 즉시 되물어 구독(자격)↔인보이스(결제) 발산을 해소.
  const reconcile = useMutation({
    mutationFn: (contractId: string) => membershipApi.reconcileInvoice(contractId),
    onSuccess: (res) => {
      invalidate();
      const label = res.invoiceStatus
        ? STATUS_LABEL[res.invoiceStatus as AdminRecurringInvoiceStatus]?.label ?? res.invoiceStatus
        : '인보이스 미발행(대기)';
      toast.success(`정합화 완료 — 권위 상태: ${label}`);
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : '정합화에 실패했습니다.'),
  });

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          정기결제 청구의 권위 상태입니다(인보이스 모델). 재시도·미수 판정은 인보이스가 소유하며,
          &ldquo;즉시 집행&rdquo;은 청구 대기/심사 대기/결제 실패 상태에서만 가능합니다.
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={runDue.isPending}
          onClick={() => {
            if (
              window.confirm(
                '만기된 모든 인보이스를 즉시 집행합니다. 유효한 결제수단이 있는 건은 실제 출금이 발생합니다. 진행할까요?',
              )
            ) {
              runDue.mutate();
            }
          }}
        >
          {runDue.isPending ? '실행 중...' : '만기 인보이스 일괄 집행'}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={searchRef}
          onChange={(e) => setSearchRef(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              setAppliedRef(searchRef.trim());
              setPage(1);
            }
          }}
          placeholder="계약 ID로 검색 (전체 ID, Enter)"
          className="h-8 w-72 rounded-md border bg-background px-2 text-xs"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setAppliedRef(searchRef.trim());
            setPage(1);
          }}
        >
          검색
        </Button>
        {appliedRef ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearchRef('');
              setAppliedRef('');
              setPage(1);
            }}
          >
            초기화
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-1">
        {STATUS_FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value || 'all'}
            type="button"
            onClick={() => {
              setStatus(opt.value);
              setPage(1);
            }}
            className={[
              'rounded-md border px-2.5 py-1 text-xs',
              status === opt.value
                ? 'border-primary bg-primary/10 font-medium text-primary'
                : 'text-muted-foreground hover:bg-muted',
            ].join(' ')}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">불러오는 중...</p>
      ) : isError ? (
        <div className="flex flex-col items-center gap-2 rounded-md border py-8">
          <p className="text-sm text-destructive">인보이스 목록을 불러오지 못했습니다.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            다시 시도
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">해당 상태의 인보이스가 없습니다.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-muted-foreground">
                <th className="p-2">상태</th>
                <th className="p-2">계약 ID</th>
                <th className="p-2">회원 ID</th>
                <th className="p-2">청구 기간</th>
                <th className="p-2 text-right">금액</th>
                <th className="p-2 text-center">시도</th>
                <th className="p-2">다음 시도</th>
                <th className="p-2">사유</th>
                <th className="p-2">결제수단</th>
                <th className="p-2 text-right">작업</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: AdminRecurringInvoiceRow) => {
                // 백엔드가 새 상태를 추가해도 화면이 깨지지 않도록 fallback.
                const badge = STATUS_LABEL[r.status] ?? { label: r.status, variant: 'outline' as const };
                return (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="p-2">
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </td>
                    <td className="p-2 font-mono text-xs" title={r.subscriberRef}>
                      {r.subscriberRef.slice(0, 8)}…
                    </td>
                    <td className="p-2 font-mono text-xs" title={r.userId ?? ''}>
                      {r.userId ? `${r.userId.slice(0, 8)}…` : '-'}
                    </td>
                    <td className="p-2 whitespace-nowrap">
                      {r.periodStart} ~ {r.periodEnd}
                    </td>
                    <td className="p-2 text-right tabular-nums">
                      {r.amountDue.toLocaleString('ko-KR')}원
                    </td>
                    <td className="p-2 text-center tabular-nums">
                      {r.attemptCount}/{r.maxAttempts}
                    </td>
                    <td className="p-2 whitespace-nowrap">
                      {r.nextAttemptAt ? new Date(r.nextAttemptAt).toLocaleString('ko-KR') : '-'}
                    </td>
                    <td className="p-2 text-xs" title={r.lastErrorMessage ?? undefined}>
                      {r.lastErrorCode ? (
                        <span className="text-destructive">
                          {r.lastErrorCode}
                          {r.lastErrorMessage ? ` · ${r.lastErrorMessage.slice(0, 24)}${r.lastErrorMessage.length > 24 ? '…' : ''}` : ''}
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="p-2 text-xs">{r.billingMethodDisplayName ?? '-'}</td>
                    <td className="p-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {r.isExecutable ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={execute.isPending}
                            onClick={() => execute.mutate(r.id)}
                          >
                            즉시 집행
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={reconcile.isPending}
                          title="wallet 인보이스 권위 상태를 되물어 자격을 즉시 정합화"
                          onClick={() => reconcile.mutate(r.subscriberRef)}
                        >
                          정합화
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            이전
          </Button>
          <span className="tabular-nums">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            다음
          </Button>
        </div>
      )}
    </div>
  );
}
