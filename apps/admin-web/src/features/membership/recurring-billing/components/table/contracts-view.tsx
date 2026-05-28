'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { useDataTable } from '@/hooks/use-data-table';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { membershipApi } from '@/lib/api/domains/membership';
import { walletApi } from '@/lib/api/domains/wallet';
import {
  AdminRecurringContractListItem,
  AgreementStateEntry,
} from '@/lib/types/dto/membership';
import { AdminRecurringBillingListQuery } from '@/lib/types/dto/wallet';

const STUCK_THRESHOLD_HOURS = 48;

type ContractRow = AdminRecurringContractListItem & {
  agreementState: AgreementStateEntry | null;
};

const columnHelper = createColumnHelper<ContractRow>();

function formatDate(str: string | null | undefined): string {
  if (!str) return '-';
  return new Date(str).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function ContractStatusBadge({ status }: { status: string }) {
  const isActive = status === 'ACTIVE';
  return (
    <Badge
      variant="outline"
      className={
        isActive
          ? 'border-green-300 bg-green-50 text-green-700'
          : 'text-muted-foreground'
      }
    >
      {status}
    </Badge>
  );
}

function AgreementStatusBadge({
  state,
}: {
  state: AgreementStateEntry | null;
}) {
  if (!state) {
    return (
      <Badge
        variant="outline"
        className="border-destructive/30 bg-destructive/5 text-destructive"
      >
        미설정
      </Badge>
    );
  }
  const label =
    state.cmsMemberStatus === 'REGISTERED'
      ? '사용 가능'
      : state.cmsMemberStatus === 'PENDING'
        ? '심사 중'
        : state.cmsMemberStatus === 'FAILED'
          ? '심사 실패'
          : (state.agreementStatus ?? '-');
  const isOk = state.cmsMemberStatus === 'REGISTERED';
  const isBad = state.cmsMemberStatus === 'FAILED';
  return (
    <Badge
      variant="outline"
      className={
        isOk
          ? 'border-green-300 bg-green-50 text-green-700'
          : isBad
            ? 'border-destructive/30 bg-destructive/5 text-destructive'
            : ''
      }
    >
      {label}
    </Badge>
  );
}

interface Props {
  query: AdminRecurringBillingListQuery;
}

function hoursElapsed(
  row: Pick<ContractRow, 'billingStartedAt' | 'updatedAt'>
): number {
  const since = row.billingStartedAt ?? row.updatedAt;
  return Math.floor(
    (Date.now() - new Date(since).getTime()) / (1000 * 60 * 60)
  );
}

export function RecurringContractsView({ query }: Props) {
  const [detailRow, setDetailRow] = useState<ContractRow | null>(null);
  const [resetReason, setResetReason] = useState('');
  const queryClient = useQueryClient();

  const closeModal = () => {
    setDetailRow(null);
    setResetReason('');
  };

  const resetBillingMutation = useMutation({
    mutationFn: ({
      contractId,
      reason,
    }: {
      contractId: string;
      reason: string;
    }) => membershipApi.resetBillingInProgress(contractId, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recurring-contracts'] });
      closeModal();
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : '플래그 해제 실패. 다시 시도해주세요.';
      toast.error(msg);
    },
  });

  const contractsQuery = {
    page: query.page,
    limit: query.limit,
    userId: query.userId,
    contractId: query.contractId,
    dateType: query.dateType,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
  };

  const {
    data: contractsRes,
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: ['recurring-contracts', contractsQuery],
    queryFn: () => membershipApi.getRecurringContracts(contractsQuery),
    staleTime: 30 * 1000,
  });

  const contractIds = useMemo(
    () => (contractsRes?.data ?? []).map((c) => c.contractId),
    [contractsRes?.data]
  );

  const { data: agreementStateMap } = useQuery({
    queryKey: ['agreement-state-by-refs', contractIds],
    queryFn: () => walletApi.getAgreementStateByRefs(contractIds),
    enabled: contractIds.length > 0,
    staleTime: 30 * 1000,
  });

  const rows: ContractRow[] = useMemo(
    () =>
      (contractsRes?.data ?? []).map((c) => ({
        ...c,
        agreementState: agreementStateMap?.[c.contractId] ?? null,
      })),
    [contractsRes?.data, agreementStateMap]
  );

  const columns = useMemo(
    () => [
      columnHelper.accessor('userId', {
        header: '고객 ID',
        cell: (info) => (
          <span className="font-mono text-xs">{info.getValue()}</span>
        ),
      }),
      columnHelper.accessor('contractId', {
        header: '계약 ID',
        cell: (info) => {
          const id = info.getValue();
          const short = `${id.slice(0, 8)}...${id.slice(-4)}`;
          return (
            <span className="inline-flex items-center gap-1">
              <span className="font-mono text-xs">{short}</span>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  void navigator.clipboard.writeText(id);
                }}
              >
                복사
              </button>
            </span>
          );
        },
      }),
      columnHelper.accessor('tierCode', { header: '티어' }),
      columnHelper.accessor('status', {
        header: '계약 상태',
        cell: (info) => <ContractStatusBadge status={info.getValue()} />,
      }),
      columnHelper.accessor('nextBillingDate', {
        header: '다음 결제일',
        cell: (info) => formatDate(info.getValue()),
      }),
      columnHelper.accessor('agreementState', {
        header: '결제 계약',
        cell: (info) => <AgreementStatusBadge state={info.getValue()} />,
      }),
      columnHelper.accessor('billingInProgress', {
        header: '결제 상태',
        cell: (info) =>
          info.getValue() ? (
            <Badge
              variant="outline"
              className="border-yellow-400 bg-yellow-50 text-yellow-700"
            >
              결제 처리 중
            </Badge>
          ) : null,
      }),
      columnHelper.display({
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDetailRow(row.original)}
          >
            상세
          </Button>
        ),
      }),
    ],
    []
  );

  const { table } = useDataTable({
    data: rows,
    columns,
    count: contractsRes?.total,
    pageSize: query.limit ?? 20,
    getRowId: (row) => row.contractId,
  });

  return (
    <>
      <DataTable
        table={table}
        isLoading={isLoading}
        isFetching={isFetching}
        count={contractsRes?.total ?? 0}
        pageSize={query.limit ?? 20}
        noRecords={{ message: '정기결제 계약이 없습니다.' }}
      />
      {detailRow && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={closeModal}
        >
          <div
            className="w-full max-w-md rounded-lg border bg-card p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-base font-semibold">계약 상세</h2>
            <div className="space-y-2 text-sm">
              {[
                ['계약 ID', detailRow.contractId],
                ['고객 ID', detailRow.userId],
                ['티어', detailRow.tierCode],
                ['계약 상태', detailRow.status],
                ['자동 갱신', detailRow.autoRenewal ? '활성화' : '비활성화'],
                ['다음 결제일', formatDate(detailRow.nextBillingDate)],
                ['시작일', formatDate(detailRow.startsAt)],
                ['종료일', formatDate(detailRow.endsAt)],
                [
                  '결제 계약',
                  detailRow.agreementState
                    ? detailRow.agreementState.billingAgreementId
                    : '없음',
                ],
                ['CMS 회원 ID', detailRow.agreementState?.cmsMemberId ?? '-'],
                [
                  'CMS 심사 상태',
                  detailRow.agreementState?.cmsMemberStatus ?? '-',
                ],
              ].map(([label, value]) => (
                <div key={label} className="flex gap-2">
                  <span className="w-32 shrink-0 text-muted-foreground">
                    {label}
                  </span>
                  <span className="flex-1 break-all font-mono text-xs">
                    {value}
                  </span>
                </div>
              ))}
              {detailRow.billingInProgress &&
                (() => {
                  const elapsed = hoursElapsed(detailRow);
                  const isStuck = elapsed >= STUCK_THRESHOLD_HOURS;
                  return (
                    <div className="flex gap-2">
                      <span className="w-32 shrink-0 text-muted-foreground">
                        결제 처리 중
                      </span>
                      <span className="flex-1 space-y-1">
                        <Badge
                          variant="outline"
                          className="border-yellow-400 bg-yellow-50 text-yellow-700"
                        >
                          처리 중 ({elapsed}시간 경과)
                        </Badge>
                        {isStuck && (
                          <p className="text-xs text-destructive">
                            {STUCK_THRESHOLD_HOURS}시간 초과 — 결제 결과 미수신.
                            수동 확인 필요.
                          </p>
                        )}
                      </span>
                    </div>
                  );
                })()}
            </div>
            {detailRow.billingInProgress &&
              hoursElapsed(detailRow) >= STUCK_THRESHOLD_HOURS && (
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    플래그 해제 사유 (감사 기록용, 필수)
                  </p>
                  <Textarea
                    rows={2}
                    placeholder="예: 결제사 확인 완료, 해당 기간 미청구 처리 합의"
                    value={resetReason}
                    onChange={(e) => setResetReason(e.target.value)}
                    className="text-sm"
                  />
                </div>
              )}
            <div className="mt-4 flex justify-end gap-2">
              {detailRow.billingInProgress &&
                hoursElapsed(detailRow) >= STUCK_THRESHOLD_HOURS && (
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={
                      resetBillingMutation.isPending || !resetReason.trim()
                    }
                    onClick={() =>
                      resetBillingMutation.mutate({
                        contractId: detailRow.contractId,
                        reason: resetReason.trim(),
                      })
                    }
                  >
                    {resetBillingMutation.isPending
                      ? '해제 중...'
                      : '플래그 해제'}
                  </Button>
                )}
              <Button variant="outline" size="sm" onClick={closeModal}>
                닫기
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
