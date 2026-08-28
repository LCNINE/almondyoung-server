'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useDeleteTimeSale, useTimeSaleList } from '@/lib/services/time-sale';
import { TIME_SALE_STATUS_LABEL, resolveTimeSaleStatus } from '../time-sale-model';
import { TimeSaleCreateDialog } from '../components/time-sale-create-dialog';

const STATUS_CLASS = {
  scheduled: 'bg-blue-100 text-blue-600',
  active: 'bg-green-100 text-green-600',
  ended: 'bg-gray-100 text-gray-500',
} as const;

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

export default function MarketingTimeSaleTemplate() {
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ title: string; ids: string[] } | null>(null);

  const { data: sales, isLoading } = useTimeSaleList();
  const deleteTimeSale = useDeleteTimeSale();

  const now = new Date();

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteTimeSale.mutateAsync(deleteTarget.ids);
      toast.success('타임세일이 삭제되었습니다. 가격이 원래대로 돌아갑니다.');
    } catch {
      toast.error('삭제에 실패했습니다.');
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <Container>
      <Header
        title="타임세일"
        right={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            타임세일 등록
          </Button>
        }
      />

      {isLoading && <p className="p-4 text-sm text-muted-foreground">불러오는 중…</p>}

      {!isLoading && (sales?.length ?? 0) === 0 && (
        <p className="p-8 text-center text-sm text-muted-foreground">
          등록된 타임세일이 없습니다.
        </p>
      )}

      {(sales?.length ?? 0) > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs">
              <tr>
                <th className="px-3 py-2 text-left">상태</th>
                <th className="px-3 py-2 text-left">이름</th>
                <th className="px-3 py-2 text-left">기간</th>
                <th className="px-3 py-2 text-left">멤버십 세일가</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {sales?.map((sale) => {
                const status = resolveTimeSaleStatus(sale.period, now);
                const ids = [sale.general?.id, sale.membership?.id].filter(Boolean) as string[];
                return (
                  <tr key={sale.title} className="border-t">
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_CLASS[status]}`}>
                        {TIME_SALE_STATUS_LABEL[status]}
                      </span>
                    </td>
                    <td className="px-3 py-2">{sale.title}</td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">
                      {formatDate(sale.period.startsAt)} → {formatDate(sale.period.endsAt)}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {sale.membership ? '있음' : '없음'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteTarget({ title: sale.title, ids })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <TimeSaleCreateDialog open={createOpen} onOpenChange={setCreateOpen} />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleteTarget?.title} 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              세일 가격이 즉시 사라지고 상품은 원래 가격으로 돌아갑니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()}>삭제</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Container>
  );
}
