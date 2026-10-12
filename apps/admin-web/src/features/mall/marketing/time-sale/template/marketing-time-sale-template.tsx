'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
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
import { useDeleteTimeSale, useSetTimeSaleStatus, useTimeSaleList } from '@/lib/services/time-sale';
import { TIME_SALE_STATUS_LABEL, resolveTimeSaleStatus } from '../time-sale-model';

const STATUS_CLASS = {
  draft: 'bg-amber-100 text-amber-700',
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
  const [deleteTarget, setDeleteTarget] = useState<{ title: string; id: string } | null>(null);
  const [publishTarget, setPublishTarget] = useState<{
    id: string;
    title: string;
    startsAt: string;
    endsAt: string;
  } | null>(null);

  const { data: sales, isLoading } = useTimeSaleList();
  const deleteTimeSale = useDeleteTimeSale();
  const setStatus = useSetTimeSaleStatus();

  const now = new Date();
  // 상태 전환은 한 번에 하나만 보낸다(버튼 전부 잠금) — useMutation 은 마지막 mutate 의 콜백만 불러,
  // 겹쳐 누르면 앞선 전환의 결과 토스트가 사라진다. 스피너는 처리 중인 행에만 돌린다.
  const statusPendingId = setStatus.isPending ? setStatus.variables?.id : undefined;

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteTimeSale.mutateAsync(deleteTarget.id);
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
          <Button asChild>
            <Link href="/mall/marketing/time-sale/new">
              <Plus className="mr-1 h-4 w-4" />
              타임세일 등록
            </Link>
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
                <th className="px-3 py-2 text-right">품목</th>
                <th className="px-3 py-2 text-left">멤버십 세일가</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {sales?.map((sale) => {
                const status = resolveTimeSaleStatus(sale.period, now, sale.status);
                const editPath = `/mall/marketing/time-sale/${sale.id}/edit`;
                return (
                  <tr
                    key={sale.id}
                    className="cursor-pointer border-t hover:bg-muted/50"
                    onClick={() => router.push(editPath)}
                  >
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_CLASS[status]}`}>
                        {TIME_SALE_STATUS_LABEL[status]}
                      </span>
                    </td>
                    <td className="px-3 py-2">{sale.title}</td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">
                      {formatDate(sale.period.startsAt)} → {formatDate(sale.period.endsAt)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {sale.variantCount}개
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {sale.hasMembership ? '있음' : '없음'}
                    </td>
                    <td
                      className="px-3 py-2 text-right"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {sale.status === 'draft' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={setStatus.isPending}
                          onClick={() =>
                            setPublishTarget({
                              id: sale.id,
                              title: sale.title,
                              startsAt: sale.period.startsAt,
                              endsAt: sale.period.endsAt,
                            })
                          }
                        >
                          {statusPendingId === sale.id && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                          공개
                        </Button>
                      ) : status === 'ended' ? null : (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={setStatus.isPending}
                          onClick={() =>
                            setStatus.mutate(
                              { id: sale.id, status: 'draft' },
                              {
                                onSuccess: () => toast.success('비공개로 바꿨습니다. 세일가가 내려갑니다.'),
                                onError: (error) =>
                                  toast.error(error instanceof Error ? error.message : '전환에 실패했습니다.'),
                              },
                            )
                          }
                        >
                          {statusPendingId === sale.id && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                          비공개
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={editPath} aria-label="수정">
                          <Pencil className="h-4 w-4" />
                        </Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="삭제"
                        onClick={() => setDeleteTarget({ title: sale.title, id: sale.id })}
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

      {/* 확인 버튼을 눌러도 처리가 끝날 때까지 창을 닫지 않는다 — 닫히면 진행 중인지 알 길이 없다 */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && !deleteTimeSale.isPending && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleteTarget?.title} 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              세일 가격이 즉시 사라지고 상품은 원래 가격으로 돌아갑니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteTimeSale.isPending}>취소</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteTimeSale.isPending}
              onClick={(event) => {
                event.preventDefault();
                void confirmDelete();
              }}
            >
              {deleteTimeSale.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!publishTarget}
        onOpenChange={(open) => !open && !setStatus.isPending && setPublishTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{publishTarget?.title} 공개</AlertDialogTitle>
            <AlertDialogDescription>
              {publishTarget && `${formatDate(publishTarget.startsAt)} → ${formatDate(publishTarget.endsAt)}`} 동안
              세일가가 고객에게 적용됩니다. 기간을 바꾸려면 먼저 수정하세요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={setStatus.isPending}>취소</AlertDialogCancel>
            <AlertDialogAction
              disabled={setStatus.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (!publishTarget) return;
                setStatus.mutate(
                  { id: publishTarget.id, status: 'active' },
                  {
                    onSuccess: () => toast.success('공개했습니다.'),
                    onError: (error) => toast.error(error instanceof Error ? error.message : '공개에 실패했습니다.'),
                    onSettled: () => setPublishTarget(null),
                  },
                );
              }}
            >
              {setStatus.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              공개
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Container>
  );
}
