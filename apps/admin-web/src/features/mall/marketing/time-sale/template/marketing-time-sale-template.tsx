'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { medusaTimeSaleSettingsApi } from '@/lib/api/domains/medusa/time-sales';
import { defaultSaleDisplay } from '@packages/domain-types/time-sale';
import {
  TimeSaleWorkspace,
  saleToast,
} from '../components/time-sale-workspace';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Pencil, Plus, Trash2 } from 'lucide-react';
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
import {
  useDeleteTimeSale,
  useTimeSaleList,
  useSetTimeSaleStatus,
} from '@/lib/services/time-sale';
import {
  TIME_SALE_STATUS_LABEL,
  resolveTimeSaleStatus,
} from '../time-sale-model';

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
  const router = useRouter();
  const [deleteTarget, setDeleteTarget] = useState<{
    title: string;
    ids: string[];
  } | null>(null);

  const { data: sales, isLoading } = useTimeSaleList();
  const deleteTimeSale = useDeleteTimeSale();

  const statusMutation = useSetTimeSaleStatus();
  const settingsQuery = useQuery({
    queryKey: ['time-sale-settings'],
    queryFn: medusaTimeSaleSettingsApi.get,
  });
  const queryClient = useQueryClient();
  const [statusTarget, setStatusTarget] = useState<{
    ids: string[];
    active: boolean;
  } | null>(null);
  const saleOrder = (sale: { priceListIds: string[] }) =>
    settingsQuery.data?.settings.sales[sale.priceListIds[0]]?.order ?? 0;
  const sortedSales = sales
    ?.slice()
    .sort((a, b) => saleOrder(a) - saleOrder(b));
  const reorder = async (index: number, direction: number) => {
    if (!sortedSales || !settingsQuery.data) return;
    const next = [...sortedSales];
    [next[index], next[index + direction]] = [
      next[index + direction],
      next[index],
    ];
    const { settings, revision } = structuredClone(settingsQuery.data);
    next.forEach((sale, i) => {
      const id = sale.priceListIds[0];
      settings.sales[id] = {
        ...(settings.sales[id] ?? defaultSaleDisplay()),
        order: i,
      };
    });
    try {
      await medusaTimeSaleSettingsApi.save(settings, revision);
      await queryClient.invalidateQueries({
        queryKey: ['time-sale-settings'],
      });
      saleToast('변경된 순서를 저장 하였습니다.');
    } catch {
      saleToast('순서를 저장하지 못했습니다. 다시 시도하세요.', true);
    }
  };
  const confirmStatus = async () => {
    if (!statusTarget) return;
    try {
      await statusMutation.mutateAsync(statusTarget);
      saleToast(
        statusTarget.active
          ? '선택한 타임세일을 활성화 하였습니다.'
          : '선택한 타임세일을 중지 하였습니다.'
      );
    } catch {
      saleToast('상태 변경에 실패했습니다.', true);
    } finally {
      setStatusTarget(null);
    }
  };
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
    <TimeSaleWorkspace>
      <Container>
        <Header
          title="타임세일"
          right={
            <Button asChild>
              <Link href="/mall/marketing/time-sale/new">
                <Plus className="mr-1 h-4 w-4" />
                타임세일 등록
              </Link>
            </Button>
          }
        />

        {isLoading && (
          <p className="p-4 text-sm text-muted-foreground">불러오는 중…</p>
        )}

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
                  <th className="px-3 py-2">순서</th>
                  <th className="px-3 py-2 text-left">상태</th>
                  <th className="px-3 py-2">활성화</th>
                  <th className="px-3 py-2 text-left">이름</th>
                  <th className="px-3 py-2 text-left">기간</th>
                  <th className="px-3 py-2 text-right">품목</th>
                  <th className="px-3 py-2 text-left">멤버십 세일가</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {sortedSales?.map((sale, index) => {
                  const status = resolveTimeSaleStatus(sale.period, now);
                  const ids = sale.priceListIds;
                  const editPath = `/mall/marketing/time-sale/${ids[0]}/edit`;
                  return (
                    <tr
                      key={ids[0]}
                      className="cursor-pointer border-t hover:bg-muted/50"
                      onClick={() => router.push(editPath)}
                    >
                      <td
                        className="px-3 py-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          disabled={index === 0}
                          aria-label="세일 위로"
                          onClick={() => void reorder(index, -1)}
                        >
                          ↑
                        </button>
                        <button
                          disabled={index === (sortedSales?.length ?? 0) - 1}
                          aria-label="세일 아래로"
                          onClick={() => void reorder(index, 1)}
                        >
                          ↓
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${STATUS_CLASS[status]}`}
                        >
                          {sale.status === 'draft'
                            ? '중지'
                            : TIME_SALE_STATUS_LABEL[status]}
                        </span>
                      </td>
                      <td
                        className="px-3 py-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={statusMutation.isPending}
                          onClick={() =>
                            setStatusTarget({
                              ids,
                              active: sale.status === 'draft',
                            })
                          }
                        >
                          {sale.status === 'draft' ? '활성화' : '중지'}
                        </Button>
                      </td>
                      <td className="px-3 py-2">{sale.title}</td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">
                        {formatDate(sale.period.startsAt)} →{' '}
                        {formatDate(sale.period.endsAt)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {sale.variantCount}개
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {sale.membershipId ? '있음' : '없음'}
                      </td>
                      <td
                        className="px-3 py-2 text-right"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={editPath} aria-label="수정">
                            <Pencil className="h-4 w-4" />
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="삭제"
                          onClick={() =>
                            setDeleteTarget({ title: sale.title, ids })
                          }
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

        <AlertDialog
          open={!!statusTarget}
          onOpenChange={(open) => !open && setStatusTarget(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>확인</AlertDialogTitle>
              <AlertDialogDescription>
                선택한 타임세일을 {statusTarget?.active ? '활성화' : '중지'}{' '}
                하시겠습니까?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>아니오</AlertDialogCancel>
              <AlertDialogAction onClick={() => void confirmStatus()}>
                예
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <AlertDialog
          open={!!deleteTarget}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{deleteTarget?.title} 삭제</AlertDialogTitle>
              <AlertDialogDescription>
                세일 가격이 즉시 사라지고 상품은 원래 가격으로 돌아갑니다.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>취소</AlertDialogCancel>
              <AlertDialogAction onClick={() => void confirmDelete()}>
                삭제
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Container>
    </TimeSaleWorkspace>
  );
}
