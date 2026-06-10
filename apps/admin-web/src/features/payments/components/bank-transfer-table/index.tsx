'use client';

import { usePendingBankTransfers, useConfirmBankTransfer } from '@/lib/services/wallet';
import { useDataTable } from '@/hooks/use-data-table';
import { useBankTransferTableColumns } from '@/hooks/table/columns/use-bank-transfer-table-columns';
import { useBankTransferTableQuery } from '@/hooks/table/query/use-bank-transfer-table-query';
import { DataTable } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

const PAGE_SIZE = 20;

export function BankTransferTable() {
  const { page, limit } = useBankTransferTableQuery({ pageSize: PAGE_SIZE });
  const { data, isLoading, isFetching } = usePendingBankTransfers(page, limit);
  const columns = useBankTransferTableColumns();
  const confirmMutation = useConfirmBankTransfer();

  const { table } = useDataTable({
    data: data?.data ?? [],
    columns,
    count: data?.total,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.id,
  });

  const handleConfirm = async (id: string) => {
    try {
      await confirmMutation.mutateAsync({ id });
      toast.success('입금 확인 완료');
    } catch {
      toast.error('입금 확인 실패');
    }
  };

  return (
    <div>
      <DataTable
        table={table}
        isLoading={isLoading}
        isFetching={isFetching}
        count={data?.total ?? 0}
        pageSize={PAGE_SIZE}
        navigateTo={(row) => `/payments/${row.original.id}`}
        noRecords={{ message: '대기 중인 무통장입금 건이 없습니다.' }}
      />
      {(data?.data ?? []).length > 0 && (
        <div className="border-t px-4 py-2">
          <p className="text-xs text-muted-foreground mb-2">행을 클릭하면 결제 상세로 이동합니다. 아래에서 입금 확인 처리할 수 있습니다.</p>
          <div className="space-y-1">
            {data?.data.map((item) => (
              <div key={item.id} className="flex items-center justify-between text-sm py-1">
                <span className="font-mono text-xs">{item.id.slice(0, 8)}... ({item.payableAmount.toLocaleString('ko-KR')}원)</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={confirmMutation.isPending}
                  onClick={() => handleConfirm(item.id)}
                >
                  입금 확인
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
