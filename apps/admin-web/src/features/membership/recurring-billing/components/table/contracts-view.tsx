'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { useDataTable } from '@/hooks/use-data-table';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { membershipApi } from '@/lib/api/domains/membership';
import { walletApi } from '@/lib/api/domains/wallet';
import { AdminRecurringContractListItem, AgreementStateEntry } from '@/lib/types/dto/membership';
import { AdminRecurringBillingListQuery } from '@/lib/types/dto/wallet';

type ContractRow = AdminRecurringContractListItem & {
  agreementState: AgreementStateEntry | null;
};

const columnHelper = createColumnHelper<ContractRow>();

function formatDate(str: string | null | undefined): string {
  if (!str) return '-';
  return new Date(str).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function ContractStatusBadge({ status }: { status: string }) {
  const isActive = status === 'ACTIVE';
  return (
    <Badge
      variant="outline"
      className={isActive ? 'border-green-300 bg-green-50 text-green-700' : 'text-muted-foreground'}
    >
      {status}
    </Badge>
  );
}

function AgreementStatusBadge({ state }: { state: AgreementStateEntry | null }) {
  if (!state) {
    return <Badge variant="outline" className="border-destructive/30 bg-destructive/5 text-destructive">미설정</Badge>;
  }
  const label = state.cmsMemberStatus === 'REGISTERED'
    ? '사용 가능'
    : state.cmsMemberStatus === 'PENDING'
    ? '심사 중'
    : state.cmsMemberStatus === 'FAILED'
    ? '심사 실패'
    : state.agreementStatus ?? '-';
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

export function RecurringContractsView({ query }: Props) {
  const [detailRow, setDetailRow] = useState<ContractRow | null>(null);

  const contractsQuery = {
    page: query.page,
    limit: query.limit,
    userId: query.userId,
    contractId: query.contractId,
    dateType: query.dateType,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
  };

  const { data: contractsRes, isLoading, isFetching } = useQuery({
    queryKey: ['recurring-contracts', contractsQuery],
    queryFn: () => membershipApi.getRecurringContracts(contractsQuery),
    staleTime: 30 * 1000,
  });

  const contractIds = useMemo(
    () => (contractsRes?.data ?? []).map((c) => c.contractId),
    [contractsRes?.data],
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
    [contractsRes?.data, agreementStateMap],
  );

  const columns = useMemo(
    () => [
      columnHelper.accessor('userId', {
        header: '고객 ID',
        cell: (info) => <span className="font-mono text-xs">{info.getValue()}</span>,
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
                onClick={() => navigator.clipboard.writeText(id)}
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
      columnHelper.display({
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <Button size="sm" variant="ghost" onClick={() => setDetailRow(row.original)}>
            상세
          </Button>
        ),
      }),
    ],
    [],
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDetailRow(null)}>
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
                ['결제 계약', detailRow.agreementState ? detailRow.agreementState.billingAgreementId : '없음'],
                ['CMS 회원 ID', detailRow.agreementState?.cmsMemberId ?? '-'],
                ['CMS 심사 상태', detailRow.agreementState?.cmsMemberStatus ?? '-'],
              ].map(([label, value]) => (
                <div key={label} className="flex gap-2">
                  <span className="w-32 shrink-0 text-muted-foreground">{label}</span>
                  <span className="flex-1 break-all font-mono text-xs">{value}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <Button variant="outline" size="sm" onClick={() => setDetailRow(null)}>닫기</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
