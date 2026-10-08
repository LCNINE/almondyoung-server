'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { medusaTimeSaleSettingsApi } from '@/lib/api/domains/medusa/time-sales';
import { defaultSaleDisplay } from '@packages/domain-types/time-sale';
import {
  TimeSaleWorkspace,
  saleToast,
} from '../components/time-sale-workspace';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  MoreHorizontal,
  Plus,
  Trash2,
  RefreshCw,
  Play,
  Pause,
} from 'lucide-react';
import {
  TimeSaleOrderButtons,
  TimeSaleHelpDialog,
} from '../components/time-sale-dialog';
import TimeSaleFormTemplate from './time-sale-form-template';
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
  moveSelectedItems,
  shortSaleNumber,
  deriveTimeSaleListStatus,
} from '../time-sale-model';

const onOff = (value: boolean) => (value ? '예' : '-');

const formatDate = (iso: string) => {
  if (!iso || !Number.isFinite(Date.parse(iso))) return '-';

  const date = new Date(iso);

  const pad = (value: number) => String(value).padStart(2, '0');

  return `${String(date.getFullYear()).slice(-2)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

// 타임세일 목록 화면: 노출 순서 변경·활성/중지·수정·삭제.
export default function MarketingTimeSaleTemplate() {
  const [form, setForm] = useState<{
    id?: string;
    mode: 'settings' | 'products';
  } | null>(null);

  const [codePartition, setCodePartition] = useState<string | null>(null);
  const [draftOrder, setDraftOrder] = useState<string[] | null>(null);
  const [orderSaving, setOrderSaving] = useState(false);

  // 삭제·상태 변경 대상은 세일별 가격표 id 묶음의 배열이다(일괄 처리).
  const [deleteTarget, setDeleteTarget] = useState<{
    title: string;
    groups: string[][];
  } | null>(null);

  const [selected, setSelected] = useState<string[]>([]);

  // 일괄 실행 중(마지막 refetch 까지) 버튼·확인창 중복 실행을 막는다.
  const [bulkPending, setBulkPending] = useState(false);

  const { data: sales, isLoading, isError } = useTimeSaleList();

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
    .sort((a, b) =>
      draftOrder
        ? draftOrder.indexOf(a.saleId) - draftOrder.indexOf(b.saleId)
        : saleOrder(a) - saleOrder(b)
    );

  // 두 세일의 위치를 바꾸고 전체 순서(order)를 설정에 다시 저장한다.
  const saveOrder = async () => {
    if (!sortedSales || !settingsQuery.data) return;

    const next = sortedSales;
    setOrderSaving(true);

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
      setDraftOrder(null);
      saleToast('변경된 순서를 저장 하였습니다.');
    } catch {
      saleToast('순서를 저장하지 못했습니다. 다시 시도하세요.', true);
    } finally {
      setOrderSaving(false);
    }
  };

  // 활성/중지 확인 후 세일별로 전환한다. 서버 거절(기간 겹침·서비스 OFF 등)은 메시지를
  // 그대로 보여주고, 일부만 실패하면 성공·실패 건수를 알린다.
  const confirmStatus = async () => {
    if (!statusTarget || bulkPending) return;
    const expired =
      statusTarget.active &&
      selectedSales.some(
        (sale) =>
          sale.groups.every(
            (group) => group.endsAt && Date.parse(group.endsAt) <= Date.now()
          ) && !displayOf(sale).repeatHours
      );

    if (expired) {
      saleToast(
        '할인 기간이 끝난 타임세일입니다. 수정에서 종료 시간을 미래로 변경한 뒤 활성화하세요.',
        true
      );
      setStatusTarget(null);
      return;
    }

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
      <div className="ts-management">
        <div className="ts-list-intro">
          <h1>타임 세일</h1>
          <ul>
            <li>
              타임세일 기간에는 기간 판매가로 판매가가 되며 종료 이후에는
              자동으로 판매가로 복원됩니다.
            </li>
            <li>
              선택한 상품의 일반 판매가와 멤버십 판매가에 기간 할인 가격을
              적용합니다.
            </li>
            <li>
              상품에 수정사항이 발생하면 쇼핑몰에 반영되기까지 시간이 소요될 수
              있습니다.
            </li>
          </ul>
        </div>
        <div className="ts-list-toolbar">
          <button
            className="ts-button ts-button-neutral"
            disabled={!draftOrder || orderSaving}
            onClick={() => void saveOrder()}
          >
            진열순위 저장
          </button>
          <TimeSaleOrderButtons
            disabled={!selectedSales.length || orderSaving}
            onMove={(direction) =>
              setDraftOrder(
                moveSelectedItems(
                  (sortedSales ?? []).map((sale) => sale.saleId),
                  selected,
                  direction
                )
              )
            }
          />
          <span className="ts-count">{sales?.length ?? 0}</span>
          <div className="ts-toolbar-spacer" />
          <button
            className="ts-icon-button"
            aria-label="새로고침"
            disabled={bulkPending}
            onClick={() => void refetchAll()}
          >
            <RefreshCw size={21} />
          </button>
          <button
            className="ts-button"
            onClick={() => setForm({ mode: 'settings' })}
          >
            <Plus size={16} />새 타임세일
          </button>
          <button
            className="ts-button ts-button-neutral"
            disabled={!selectedSales.length || bulkPending}
            onClick={() =>
              setStatusTarget({
                groups: selectedSales.map((sale) => sale.priceListIds),
                active: true,
              })
            }
          >
            <Play size={13} fill="currentColor" />
            활성
          </button>
          <button
            className="ts-button ts-button-neutral"
            disabled={!selectedSales.length || bulkPending}
            onClick={() =>
              setStatusTarget({
                groups: selectedSales.map((sale) => sale.priceListIds),
                active: false,
              })
            }
          >
            <Pause size={13} fill="currentColor" />
            중지
          </button>
          <button
            className="ts-button ts-button-neutral"
            disabled={!selectedSales.length || bulkPending}
            onClick={() =>
              setDeleteTarget({
                title: `선택한 타임세일 ${selectedSales.length}건`,
                groups: selectedSales.map((sale) => sale.priceListIds),
              })
            }
          >
            <Trash2 size={13} />
            삭제
          </button>
        </div>
        <div className="ts-table-scroll">
          <table className="ts-table ts-sale-table">
            <thead>
              <tr>
                <th>
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
                <th>
                  진열
                  <br />
                  순위
                </th>
                <th>
                  상태
                  <br />
                  <small>(브라우저 표시)</small>
                </th>
                <th>파티션ID</th>
                <th>명칭</th>
                <th>타임세일번호</th>
                <th>GA4 프로모션ID</th>
                <th>기간구분</th>
                <th>기간</th>
                <th>SHIFT 반복</th>
                <th>전시모드</th>
                <th>품절상품표시</th>
                <th>예정</th>
                <th>마감</th>
                <th>수정</th>
                <th>상품진열</th>
              </tr>
            </thead>
            <tbody>
              {sortedSales?.map((sale, index) => {
                const status = statusOf(sale);

                const display = displayOf(sale);

                const perProduct = sale.groups.some(
                  (group) => group.productId !== null
                );

                const [statusText, browserText] =
                  TIME_SALE_LIST_STATUS_LABEL[status].split('(');

                return (
                  <tr
                    key={sale.saleId}
                    className={
                      selected.includes(sale.saleId) ? 'ts-row-selected' : ''
                    }
                  >
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`${sale.title} 선택`}
                        checked={selected.includes(sale.saleId)}
                        onChange={() => toggleSelected(sale.saleId)}
                      />
                    </td>
                    <td>{index + 1}</td>
                    <td>
                      <span className="ts-status">{statusText}</span>
                      <br />
                      <span className={`ts-status-detail ts-status-${status}`}>
                        ({browserText}
                      </span>
                    </td>
                    <td>
                      {display.partitionId || ''}
                      {display.partitionId && (
                        <>
                          <br />
                          <button
                            className="ts-button"
                            onClick={() =>
                              setCodePartition(display.partitionId)
                            }
                          >
                            CODE
                          </button>
                        </>
                      )}
                    </td>
                    <td className="ts-name">{sale.title}</td>
                    <td>{shortSaleNumber(sale.saleId)}</td>
                    <td title={display.webId || sale.saleId}>
                      {display.webId || shortSaleNumber(sale.saleId)}
                    </td>
                    <td>{perProduct ? '개별 할인 기간' : '단일 할인 기간'}</td>
                    <td className={perProduct ? 'ts-readonly' : ''}>
                      {perProduct && (
                        <>
                          <span>읽기 전용</span>
                          <br />
                        </>
                      )}
                      {formatDate(sale.period.startsAt)}
                      <br />
                      {formatDate(sale.period.endsAt)}
                    </td>
                    <td>
                      {display.repeatHours ? `${display.repeatHours}시간` : '-'}
                    </td>
                    <td>
                      {display.detail && !display.main && !display.more
                        ? '예'
                        : '-'}
                    </td>
                    <td>{onOff(display.showSoldOut)}</td>
                    <td>{onOff(display.showScheduled)}</td>
                    <td>{onOff(display.showEnded)}</td>
                    <td>
                      <button
                        className="ts-button"
                        aria-label={`${sale.title} 수정`}
                        onClick={() =>
                          setForm({ id: sale.saleId, mode: 'settings' })
                        }
                      >
                        수정
                      </button>
                    </td>
                    <td>
                      <div className="ts-row-actions">
                        <button
                          className="ts-button"
                          aria-label={`${sale.title} 상품진열`}
                          onClick={() =>
                            setForm({ id: sale.saleId, mode: 'products' })
                          }
                        >
                          {sale.productIds.length} / 60
                        </button>
                        <button
                          className="ts-variable-button"
                          aria-label={`${sale.title} 상품별 사용자 변수`}
                          onClick={() => setVariableTarget(index)}
                        >
                          <MoreHorizontal size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {isLoading && <p className="ts-empty">불러오는 중…</p>}
        {isError && (
          <p role="alert" className="ts-empty">
            타임세일 목록을 불러오지 못했습니다. 새로고침 버튼으로 다시
            시도하세요.
          </p>
        )}
        {!isLoading && !isError && !sales?.length && (
          <p className="ts-empty">등록된 타임세일이 없습니다.</p>
        )}
        {form && (
          <TimeSaleFormTemplate
            generalId={form.id}
            mode={form.mode}
            onClose={() => setForm(null)}
          />
        )}
        <TimeSaleHelpDialog
          open={codePartition !== null}
          partitionId={codePartition ?? undefined}
          onClose={() => setCodePartition(null)}
        />

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
      </div>
    </TimeSaleWorkspace>
  );
}
