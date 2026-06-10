'use client';

import { usePendingBankTransfers } from '@/lib/services/wallet';
import { useDataTable } from '@/hooks/use-data-table';
import { useBankTransferTableColumns } from '@/hooks/table/columns/use-bank-transfer-table-columns';
import { useBankTransferTableQuery } from '@/hooks/table/query/use-bank-transfer-table-query';
import { DataTable } from '@/components/data-table';

const PAGE_SIZE = 20;

export function BankTransferTable() {
  const { page, limit } = useBankTransferTableQuery({ pageSize: PAGE_SIZE });
  const { data, isLoading, isFetching } = usePendingBankTransfers(page, limit);
  const columns = useBankTransferTableColumns();

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
      navigateTo={(row) => `/payments/${row.original.id}`}
      noRecords={{ message: '대기 중인 무통장입금 건이 없습니다.' }}
    />
  );
}
