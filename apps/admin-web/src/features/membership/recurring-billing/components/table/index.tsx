'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRecurringBillingItems, usePollCmsMember, usePollCmsWithdrawal } from '@/lib/services/membership';
import { useDataTable } from '@/hooks/use-data-table';
import { useRecurringBillingTableColumns } from '@/hooks/table/columns/use-recurring-billing-table-columns';
import { useRecurringBillingTableQuery } from '@/hooks/table/query/use-recurring-billing-table-query';
import { DataTable } from '@/components/data-table';
import { membershipApi } from '@/lib/api/domains/membership';
import { AdminRecurringBillingRow } from '@/lib/types/dto/wallet';
import { AdminRecurringContractSummary } from '@/lib/types/dto/membership';
import { RecurringBillingDetailDialog } from '../detail-dialog';
import { RecurringContractsView } from './contracts-view';

const PAGE_SIZE = 20;

export function RecurringBillingTable() {
  const query = useRecurringBillingTableQuery(PAGE_SIZE);

  if (query.view === 'contracts') {
    return <RecurringContractsView query={query} />;
  }

  return <RecurringBillingCmsTable query={query} />;
}

function RecurringBillingCmsTable({ query }: { query: ReturnType<typeof useRecurringBillingTableQuery> }) {
  const [selectedRow, setSelectedRow] = useState<AdminRecurringBillingRow | null>(null);

  const { data, isLoading, isFetching } = useRecurringBillingItems(query);
  const pollMember = usePollCmsMember();
  const pollWithdrawal = usePollCmsWithdrawal();

  const contractIds = useMemo(
    () =>
      (data?.data ?? [])
        .filter((r) => r.subscriberType === 'MEMBERSHIP' && r.subscriberRef)
        .map((r) => r.subscriberRef!)
        .filter((v, i, a) => a.indexOf(v) === i),
    [data?.data],
  );

  const { data: contracts } = useQuery<AdminRecurringContractSummary[]>({
    queryKey: ['recurring-billing-contracts', contractIds],
    queryFn: () => membershipApi.getRecurringContractsByIds(contractIds),
    enabled: contractIds.length > 0,
    staleTime: 30 * 1000,
  });

  const contractMap = useMemo(() => {
    const map: Record<string, AdminRecurringContractSummary> = {};
    for (const c of contracts ?? []) {
      map[c.contractId] = c;
    }
    return map;
  }, [contracts]);

  const columns = useRecurringBillingTableColumns({
    onDetail: setSelectedRow,
    onPollMember: (row) => {
      const id = row.providerState?.cmsMemberRowId;
      if (id) pollMember.mutate(id);
    },
    onPollWithdrawal: (row) => {
      const wId = row.providerState?.withdrawalId;
      if (wId) pollWithdrawal.mutate(wId);
    },
    view: query.view,
  });

  const { table } = useDataTable({
    data: data?.data ?? [],
    columns,
    count: data?.total,
    pageSize: PAGE_SIZE,
    getRowId: (row) =>
      `${row.userId}-${row.paymentIntentId ?? row.providerState?.transactionId ?? row.createdAt}`,
  });

  return (
    <>
      <DataTable
        table={table}
        isLoading={isLoading}
        isFetching={isFetching}
        count={data?.total ?? 0}
        pageSize={PAGE_SIZE}
        noRecords={{ message: '정기결제 데이터가 없습니다.' }}
      />
      <RecurringBillingDetailDialog
        row={selectedRow}
        contract={
          selectedRow?.subscriberRef ? contractMap[selectedRow.subscriberRef] : undefined
        }
        open={!!selectedRow}
        onClose={() => setSelectedRow(null)}
      />
    </>
  );
}
