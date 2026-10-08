'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { medusaTimeSaleSettingsApi } from '@/lib/api/domains/medusa/time-sales';
import {
  defaultSaleDisplay,
  type SaleDisplay,
} from '@packages/domain-types/time-sale';
import {
  TimeSaleWorkspace,
  saleToast,
} from '../components/time-sale-workspace';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
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
  TimeSaleValidationError,
  useDeleteTimeSale,
  useTimeSaleList,
  useSetTimeSaleStatus,
} from '@/lib/services/time-sale';
import { TimeSaleProductVariablesDialog } from '../components/time-sale-product-variables-dialog';
import {
  TIME_SALE_LIST_STATUS_LABEL,
  formatShiftRepeat,
  shortSaleNumber,
  deriveTimeSaleListStatus,
  type TimeSaleListStatus,
} from '../time-sale-model';

// 세일 상태 뱃지 색(예정=파랑, 진행=초록, 중지=노랑, 마감·서비스 OFF=회색).
const STATUS_CLASS: Record<TimeSaleListStatus, string> = {
  scheduled: 'bg-blue-100 text-blue-600',
  active: 'bg-green-100 text-green-600',
  stopped: 'bg-yellow-100 text-yellow-700',
  ended: 'bg-gray-100 text-gray-500',
  suspended: 'bg-gray-100 text-gray-500',
};

// 전시모드 칸: 메인·더보기·상세 중 켜진 곳.
const displayModes = (display: SaleDisplay) =>
  [display.main && '메인', display.more && '더보기', display.detail && '상세']
    .filter(Boolean)
    .join('·') || '-';

const onOff = (value: boolean) => (value ? 'O' : 'X');

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

// 타임세일 목록 화면: 노출 순서 변경·활성/중지·수정·삭제.
export default function MarketingTimeSaleTemplate() {
  const router = useRouter();
  // 삭제·상태 변경 대상은 세일별 가격표 id 묶음의 배열이다(일괄 처리).
  const [deleteTarget, setDeleteTarget] = useState<{
    title: string;
    groups: string[][];
  } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  // 일괄 실행 중(마지막 refetch 까지) 버튼·확인창 중복 실행을 막는다.
  const [bulkPending, setBulkPending] = useState(false);

  const { data: sales, isLoading } = useTimeSaleList();
  const deleteTimeSale = useDeleteTimeSale();

  const statusMutation = useSetTimeSaleStatus();
  const settingsQuery = useQuery({
    queryKey: ['time-sale-settings'],
    queryFn: medusaTimeSaleSettingsApi.get,
  });
  const queryClient = useQueryClient();
  const [variableTarget, setVariableTarget] = useState<number | null>(null);
  const [statusTarget, setStatusTarget] = useState<{
    groups: string[][];
    active: boolean;
  } | null>(null);
  // 노출 순서는 세일별 설정(order)에 저장돼 있고, 없으면 0.
  const saleOrder = (sale: { saleId: string }) =>
    settingsQuery.data?.settings.sales[sale.saleId]?.order ?? 0;
  const sortedSales = sales
    ?.slice()
    .sort((a, b) => saleOrder(a) - saleOrder(b));
  // 두 세일의 위치를 바꾸고 전체 순서(order)를 설정에 다시 저장한다.
  const reorder = async (index: number, direction: number) => {
    if (!sortedSales || !settingsQuery.data) return;
    const next = [...sortedSales];
    [next[index], next[index + direction]] = [
      next[index + direction],
      next[index],
    ];
    const { settings, revision } = structuredClone(settingsQuery.data);
    next.forEach((sale, i) => {
      const id = sale.saleId;
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
  // 활성/중지 확인 후 세일별로 전환한다. 서버 거절(기간 겹침·서비스 OFF 등)은 메시지를
  // 그대로 보여주고, 일부만 실패하면 성공·실패 건수를 알린다.
  const confirmStatus = async () => {
    if (!statusTarget || bulkPending) return;
    setBulkPending(true);

    const { groups, active } = statusTarget;
    let done = 0;
    let failMessage = '';

    for (const ids of groups) {
      try {
        await statusMutation.mutateAsync({ ids, active });
        done += 1;
      } catch (error) {
        failMessage =
          error instanceof TimeSaleValidationError
            ? error.message
            : '상태 변경에 실패했습니다.';
      }
    }

    const failed = groups.length - done;
    if (failed === 0) {
      saleToast(
        active
          ? '선택한 타임세일을 활성화 하였습니다.'
          : '선택한 타임세일을 중지 하였습니다.'
      );
    } else if (done === 0) {
      saleToast(failMessage, true);
    } else {
      saleToast(`${done}건 성공, ${failed}건 실패: ${failMessage}`, true);
    }

    await refetchAll();
    setSelected([]);
    setStatusTarget(null);
    setBulkPending(false);
  };
  // 목록과 설정(서비스 OFF 로 멈춘 가격표 id 포함)을 같이 다시 읽는다.
  const refetchAll = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['time-sales'] }),
      queryClient.invalidateQueries({ queryKey: ['time-sale-settings'] }),
    ]);
  const now = new Date();
  const service = settingsQuery.data?.settings.environment;
  const displayOf = (sale: { saleId: string }) =>
    settingsQuery.data?.settings.sales[sale.saleId] ?? defaultSaleDisplay();
  // 상품별 기간이면 묶음별 기간으로, 아니면 세일 기간 하나로 상태를 본다.
  const statusOf = (sale: NonNullable<typeof sortedSales>[number]) => {
    const perProduct = sale.groups.some((group) => group.productId !== null);
    const periods = perProduct
      ? sale.groups.map((group) => ({
          startsAt: group.startsAt ?? '',
          endsAt: group.endsAt ?? '',
        }))
      : [sale.period];
    return deriveTimeSaleListStatus(
      { status: sale.status, priceListIds: sale.priceListIds, periods },
      {
        // 설정을 아직 못 받았으면 OFF 로 오인하지 않도록 켜진 것으로 본다.
        enabled: service?.enabled ?? true,
        suspendedPriceListIds: service?.suspendedPriceListIds ?? [],
      },
      now
    );
  };
  const selectedSales = (sortedSales ?? []).filter((sale) =>
    selected.includes(sale.saleId)
  );
  const allSelected =
    (sortedSales?.length ?? 0) > 0 && selected.length === sortedSales?.length;
  const toggleSelected = (saleId: string) =>
    setSelected((prev) =>
      prev.includes(saleId)
        ? prev.filter((id) => id !== saleId)
        : [...prev, saleId]
    );

  // 삭제 확인 후 세일별로 가격표를 모두 지운다(가격이 원래대로 돌아간다).
  // 일부만 실패하면 건수를 알리고 목록을 다시 읽는다.
  const confirmDelete = async () => {
    if (!deleteTarget || bulkPending) return;
    setBulkPending(true);

    const { groups } = deleteTarget;
    let done = 0;

    for (const ids of groups) {
      try {
        await deleteTimeSale.mutateAsync(ids);
        done += 1;
      } catch {
        // 실패 건수는 아래에서 센다.
      }
    }
    const failed = groups.length - done;
    if (failed === 0) {
      toast.success('타임세일이 삭제되었습니다. 가격이 원래대로 돌아갑니다.');
    } else {
      toast.error(`${done}건 삭제, ${failed}건 실패했습니다.`);
    }

    await refetchAll();
    setSelected([]);
    setDeleteTarget(null);
    setBulkPending(false);
  };

  return (
    <TimeSaleWorkspace>
      <Container>
        <Header
          title="타임세일"
          right={
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={bulkPending}
                onClick={() => void refetchAll()}
              >
                새로고침
              </Button>
              <Button
                variant="outline"
                disabled={selectedSales.length === 0 || bulkPending}
                onClick={() =>
                  setStatusTarget({
                    groups: selectedSales.map((sale) => sale.priceListIds),
                    active: true,
                  })
                }
              >
                활성
              </Button>
              <Button
                variant="outline"
                disabled={selectedSales.length === 0 || bulkPending}
                onClick={() =>
                  setStatusTarget({
                    groups: selectedSales.map((sale) => sale.priceListIds),
                    active: false,
                  })
                }
              >
                중지
              </Button>
              <Button
                variant="outline"
                disabled={selectedSales.length === 0 || bulkPending}
                onClick={() =>
                  setDeleteTarget({
                    title: `선택한 타임세일 ${selectedSales.length}건`,
                    groups: selectedSales.map((sale) => sale.priceListIds),
                  })
                }
              >
                삭제
              </Button>
              <Button asChild>
                <Link href="/mall/marketing/time-sale/new">
                  <Plus className="mr-1 h-4 w-4" />
                  타임세일 등록
                </Link>
              </Button>
            </div>
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
                  <th className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label="전체 선택"
                      checked={allSelected}
                      onChange={() =>
                        setSelected(
                          allSelected
                            ? []
                            : (sortedSales ?? []).map((sale) => sale.saleId)
                        )
                      }
                    />
                  </th>
                  <th className="px-3 py-2">진열순위</th>
                  <th className="px-3 py-2 text-left">상태</th>
                  <th className="px-3 py-2 text-left">파티션ID</th>
                  <th className="px-3 py-2 text-left">명칭</th>
                  <th className="px-3 py-2">번호</th>
                  <th className="px-3 py-2 text-left">웹로그ID</th>
                  <th className="px-3 py-2">기간구분</th>
                  <th className="px-3 py-2 text-left">기간</th>
                  <th className="px-3 py-2 text-right">품목</th>
                  <th className="px-3 py-2">SHIFT 반복</th>
                  <th className="px-3 py-2">전시모드</th>
                  <th className="px-3 py-2">품절표시</th>
                  <th className="px-3 py-2">예정</th>
                  <th className="px-3 py-2">마감</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {sortedSales?.map((sale, index) => {
                  const status = statusOf(sale);
                  const display = displayOf(sale);
                  const ids = sale.priceListIds;
                  const perProduct = sale.groups.some(
                    (group) => group.productId !== null
                  );
                  const editPath = `/mall/marketing/time-sale/${sale.saleId}/edit`;
                  return (
                    <tr
                      key={sale.saleId}
                      className="cursor-pointer border-t hover:bg-muted/50"
                      onClick={() => router.push(editPath)}
                    >
                      <td
                        className="px-3 py-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          aria-label={`${sale.title} 선택`}
                          checked={selected.includes(sale.saleId)}
                          onChange={() => toggleSelected(sale.saleId)}
                        />
                      </td>
                      <td
                        className="px-3 py-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="mr-1 tabular-nums">{index + 1}</span>
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
                          {TIME_SALE_LIST_STATUS_LABEL[status]}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {display.partitionId || '-'}
                      </td>
                      <td className="px-3 py-2">{sale.title}</td>
                      <td className="px-3 py-2 text-center tabular-nums">
                        {shortSaleNumber(sale.saleId)}
                      </td>
                      <td className="px-3 py-2">{display.webId || '-'}</td>
                      <td className="px-3 py-2 text-center">
                        {perProduct ? '상품별' : '전체'}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">
                        {perProduct
                          ? '상품별 기간'
                          : `${formatDate(sale.period.startsAt)} → ${formatDate(sale.period.endsAt)}`}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {sale.variantCount}개
                      </td>
                      <td className="px-3 py-2 text-center">
                        {formatShiftRepeat(display)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {displayModes(display)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {onOff(display.showSoldOut)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {onOff(display.showScheduled)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {onOff(display.showEnded)}
                      </td>
                      <td
                        className="px-3 py-2 text-right"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="상품별 사용자 변수"
                          onClick={() => setVariableTarget(index)}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={editPath}>상품진열</Link>
                        </Button>
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
                            setDeleteTarget({
                              title: sale.title,
                              groups: [ids],
                            })
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

        <TimeSaleProductVariablesDialog
          sale={
            variableTarget === null
              ? null
              : (sortedSales?.[variableTarget] ?? null)
          }
          index={(variableTarget ?? 0) + 1}
          settings={settingsQuery.data?.settings}
          revision={settingsQuery.data?.revision ?? ''}
          onClose={() => setVariableTarget(null)}
        />
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
              <AlertDialogAction
                disabled={bulkPending}
                onClick={() => void confirmStatus()}
              >
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
              <AlertDialogAction
                disabled={bulkPending}
                onClick={() => void confirmDelete()}
              >
                삭제
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Container>
    </TimeSaleWorkspace>
  );
}
