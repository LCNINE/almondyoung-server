'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { useBillingHistory } from '@/lib/services/membership';
import { useBillingHistoryTableQuery } from '@/hooks/table/query/use-billing-history-table-query';
import { useDataTable } from '@/hooks/use-data-table';
import { DataTable } from '@/components/data-table';
import { AdminBillingHistoryItem } from '@/lib/api/domains/membership';
import Link from 'next/link';

const PAGE_SIZE = 20;

const columnHelper = createColumnHelper<AdminBillingHistoryItem>();

const eventTypeConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  CHARGE_SUCCESS: { label: '결제 성공', variant: 'default' },
  CHARGE_FAIL: { label: '결제 실패', variant: 'destructive' },
  CHARGE_ATTEMPT: { label: '결제 시도', variant: 'secondary' },
};

function useColumns() {
  return useMemo(
    () => [
      columnHelper.accessor('userId', {
        header: '자사몰 아이디',
        cell: ({ getValue }) => (
          <Link
            href={`/customer-window/${getValue()}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary text-xs hover:underline"
          >
            {getValue()}
          </Link>
        ),
      }),
      columnHelper.accessor('contractId', {
        header: '계약 ID',
        cell: ({ getValue }) => <span className="text-xs text-muted-foreground">{getValue()}</span>,
      }),
      columnHelper.accessor('eventType', {
        header: '결제 유형',
        cell: ({ getValue }) => {
          const cfg = eventTypeConfig[getValue()] ?? { label: getValue(), variant: 'outline' as const };
          return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
        },
      }),
      columnHelper.accessor('attemptNo', {
        header: '시도 횟수',
        cell: ({ getValue }) => <span className="text-sm">{getValue() ?? '-'}</span>,
      }),
      columnHelper.accessor('amount', {
        header: '금액',
        cell: ({ getValue }) => {
          const v = getValue();
          return <span className="text-sm">{v != null ? `${v.toLocaleString()}원` : '-'}</span>;
        },
      }),
      columnHelper.accessor('errorCode', {
        header: '실패 사유',
        cell: ({ getValue, row }) => {
          const code = getValue();
          if (!code) return <span className="text-sm text-muted-foreground">-</span>;
          return (
            <span className="text-sm text-destructive" title={row.original.errorMessage ?? undefined}>
              {code}
            </span>
          );
        },
      }),
      columnHelper.accessor('createdAt', {
        header: '결제일',
        cell: ({ getValue }) => (
          <span className="text-sm">
            {new Date(getValue()).toLocaleString('ko-KR')}
          </span>
        ),
      }),
    ],
    [],
  );
}

export function BillingHistoryTable() {
  const query = useBillingHistoryTableQuery(PAGE_SIZE);
  const { data, isLoading, isFetching } = useBillingHistory(query);
  const columns = useColumns();

  const { table } = useDataTable({
    data: data?.data ?? [],
    columns,
    count: data?.total,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.id,
  });

  return (
    <DataTable
      table={table}
      isLoading={isLoading}
      isFetching={isFetching}
      count={data?.total ?? 0}
      pageSize={PAGE_SIZE}
      noRecords={{ message: '결제 내역이 없습니다.' }}
    />
  );
}
