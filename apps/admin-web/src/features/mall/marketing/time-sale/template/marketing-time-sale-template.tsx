'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pause, Play, Plus, RefreshCw, Trash2 } from 'lucide-react';
import {
  TimeSaleWorkspace,
  saleToast,
} from '../components/time-sale-workspace';
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
  useCreateTimeSale,
  useDeleteTimeSale,
  useSetTimeSaleStatus,
  useTimeSaleList,
  useUpdateTimeSale,
} from '@/lib/services/time-sale';
import { BlockedReason } from '@/components/auth/blocked-reason';
import { usePermissionCheck } from '@/hooks/use-permission';
import {
  TIME_SALE_STATUS_LABEL,
  resolveTimeSaleStatus,
  shortSaleNumber,
} from '../time-sale-model';
import TimeSaleFormTemplate from './time-sale-form-template';

const formatDate = (iso: string) => {
  if (!iso || !Number.isFinite(Date.parse(iso))) return '-';

  const date = new Date(iso);

  const pad = (value: number) => String(value).padStart(2, '0');

  return `${String(date.getFullYear()).slice(-2)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

// 타임세일 목록 화면: 공개/비공개 전환·수정·삭제. 저장은 세일 하나당 Medusa 라우트 한 번이다.
export default function MarketingTimeSaleTemplate() {
  // null: 닫힘, 'new': 신규, 그 외: 수정할 세일 id
  const [formTarget, setFormTarget] = useState<string | null>(null);
  const [productsTarget, setProductsTarget] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: sales, isLoading, isError } = useTimeSaleList();
  const deleteTimeSale = useDeleteTimeSale();
  const setStatus = useSetTimeSaleStatus();
  const { canRun, blockedReason } = usePermissionCheck();
  const canSetStatus = canRun(useSetTimeSaleStatus);
  const productsBlocked = blockedReason(useUpdateTimeSale);

  const [selected, setSelected] = useState<string[]>([]);
  const [statusTarget, setStatusTarget] = useState<'draft' | 'active' | null>(
    null
  );
  const [deleteOpen, setDeleteOpen] = useState(false);

  // 일괄 실행 중(마지막 refetch 까지) 버튼·확인창 중복 실행을 막는다.
  const [bulkPending, setBulkPending] = useState(false);

  const now = new Date();
  const selectedSales = (sales ?? []).filter((sale) =>
    selected.includes(sale.id)
  );
  const allSelected =
    (sales?.length ?? 0) > 0 && selected.length === sales?.length;

  const toggleSelected = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );

  const refetch = () =>
    queryClient.invalidateQueries({ queryKey: ['time-sales'] });

  // 선택한 세일마다 같은 작업을 하고 성공·실패 건수를 알린다. 서버 거절(겹침 등)은 사유를 그대로 보여준다.
  const runBulk = async (
    task: (id: string) => Promise<unknown>,
    done: string
  ) => {
    if (bulkPending) return;
    setBulkPending(true);

    let ok = 0;
    let failMessage = '';
    for (const sale of selectedSales) {
      try {
        await task(sale.id);
        ok += 1;
      } catch (error) {
        failMessage =
          error instanceof TimeSaleValidationError
            ? error.message
            : '처리하지 못했습니다.';
      }
    }

    const failed = selectedSales.length - ok;
    if (failed === 0) saleToast(done);
    else if (ok === 0) saleToast(failMessage, true);
    else saleToast(`${ok}건 성공, ${failed}건 실패: ${failMessage}`, true);

    await refetch();
    setSelected([]);
    setBulkPending(false);
  };

  const confirmStatus = async () => {
    if (!statusTarget) return;
    const status = statusTarget;
    setStatusTarget(null);
    await runBulk(
      (id) => setStatus.mutateAsync({ id, status }),
      status === 'active'
        ? '선택한 타임세일을 공개 하였습니다.'
        : '선택한 타임세일을 비공개로 바꾸었습니다.'
    );
  };

  const confirmDelete = async () => {
    setDeleteOpen(false);
    await runBulk(
      (id) => deleteTimeSale.mutateAsync(id),
      '타임세일이 삭제되었습니다. 가격이 원래대로 돌아갑니다.'
    );
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
              비공개 세일은 가격에 영향을 주지 않습니다. 공개하면 기간 동안
              쇼핑몰에 반영됩니다.
            </li>
          </ul>
        </div>
        <div className="ts-list-toolbar">
          <span className="ts-count">
            {selected.length} / {sales?.length ?? 0}
          </span>
          <div className="ts-toolbar-spacer" />
          <button
            className="ts-icon-button"
            aria-label="새로고침"
            disabled={bulkPending}
            onClick={() => void refetch()}
          >
            <RefreshCw size={21} />
          </button>
          {canRun(useCreateTimeSale) && (
            <button className="ts-button" onClick={() => setFormTarget('new')}>
              <Plus size={16} />새 타임세일
            </button>
          )}
          {canSetStatus && (
            <button
              className="ts-button ts-button-neutral"
              disabled={!selectedSales.length || bulkPending}
              onClick={() => setStatusTarget('active')}
            >
              <Play size={13} fill="currentColor" />
              공개
            </button>
          )}
          {canSetStatus && (
            <button
              className="ts-button ts-button-neutral"
              disabled={!selectedSales.length || bulkPending}
              onClick={() => setStatusTarget('draft')}
            >
              <Pause size={13} fill="currentColor" />
              비공개
            </button>
          )}
          {canRun(useDeleteTimeSale) && (
            <button
              className="ts-button ts-button-neutral"
              disabled={!selectedSales.length || bulkPending}
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 size={13} />
              삭제
            </button>
          )}
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
                        allSelected ? [] : (sales ?? []).map((sale) => sale.id)
                      )
                    }
                  />
                </th>
                <th>
                  상태
                  <br />
                  <small>(브라우저 표시)</small>
                </th>
                <th>명칭</th>
                <th>타임세일번호</th>
                <th>기간</th>
                <th>수정</th>
                <th>상품진열</th>
              </tr>
            </thead>
            <tbody>
              {sales?.map((sale) => {
                const status = resolveTimeSaleStatus(
                  sale.period,
                  now,
                  sale.status
                );

                return (
                  <tr
                    key={sale.id}
                    className={
                      selected.includes(sale.id) ? 'ts-row-selected' : ''
                    }
                  >
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`${sale.title} 선택`}
                        checked={selected.includes(sale.id)}
                        onChange={() => toggleSelected(sale.id)}
                      />
                    </td>
                    <td>
                      {status === 'draft' ? (
                        <>
                          <span className="ts-status">비공개</span>
                          <br />
                          <span className="ts-readonly">(없음)</span>
                        </>
                      ) : (
                        <>
                          <span className="ts-status ts-status-active">
                            공개
                          </span>
                          <br />
                          <span className="ts-status-detail">
                            ({TIME_SALE_STATUS_LABEL[status]})
                          </span>
                        </>
                      )}
                    </td>
                    <td className="ts-name">
                      {sale.title}
                      {sale.issues?.map((issue) => (
                        <p key={issue} className="ts-display-error">
                          ⚠ {issue}
                        </p>
                      ))}
                    </td>
                    <td title={sale.id}>{shortSaleNumber(sale.id)}</td>
                    <td>
                      {formatDate(sale.period.startsAt)}
                      <br />
                      {formatDate(sale.period.endsAt)}
                    </td>
                    <td>
                      {canRun(useUpdateTimeSale) && (
                        <button
                          className="ts-button"
                          aria-label={`${sale.title} 수정`}
                          onClick={() => setFormTarget(sale.id)}
                        >
                          수정
                        </button>
                      )}
                    </td>
                    <td>
                      <BlockedReason reason={productsBlocked}>
                        {(blocked) => (
                          <button
                            {...blocked}
                            className="ts-button"
                            aria-label={`${sale.title} 상품진열`}
                            onClick={
                              productsBlocked
                                ? undefined
                                : () => setProductsTarget(sale.id)
                            }
                          >
                            {sale.productIds.length}
                          </button>
                        )}
                      </BlockedReason>
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

        {formTarget && (
          <TimeSaleFormTemplate
            key={formTarget}
            timeSaleId={formTarget === 'new' ? undefined : formTarget}
            onClose={() => setFormTarget(null)}
            part="info"
          />
        )}
        {productsTarget && (
          <TimeSaleFormTemplate
            key={productsTarget}
            timeSaleId={productsTarget}
            onClose={() => setProductsTarget(null)}
            part="products"
          />
        )}
        <AlertDialog
          open={!!statusTarget}
          onOpenChange={(open) => !open && setStatusTarget(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>확인</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div>
                  <p>
                    선택한 타임세일 {selectedSales.length}건을{' '}
                    {statusTarget === 'active' ? '공개' : '비공개로 전환'}
                    하시겠습니까?
                  </p>
                  {statusTarget === 'active' && (
                    <ul className="mt-2 list-disc pl-5">
                      {selectedSales.map((sale) => (
                        <li key={sale.id}>
                          {sale.title}: {formatDate(sale.period.startsAt)} ~{' '}
                          {formatDate(sale.period.endsAt)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
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
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                선택한 타임세일 {selectedSales.length}건 삭제
              </AlertDialogTitle>
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
