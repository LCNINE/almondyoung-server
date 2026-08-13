'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  selectedIdsFromRowSelection,
  reconcileSelectedSnapshots,
  selectionFromItems,
  type SelectedProductSnapshot,
} from './products-list-selection-model';
import {
  canSelectAll,
  hasActiveFilter,
  filterSignature,
  selectionStaleness,
} from './products-list-page-size-model';
import { useMastersSummary } from '@/lib/services/products/queries';
import { useMasterSelection } from '@/lib/services/products/mutations';
import { useRequestFormExport } from '@/lib/services/products/form-export';
import { parseServerError } from '@/lib/api/server-error';
import { useDataTable } from '@/hooks/use-data-table';
import { useProductsListTableColumns } from '@/hooks/table/columns/use-products-list-table-columns';
import { useProductsListTableQuery } from '@/hooks/table/query/use-products-list-table-query';
import { DataTable } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Trash2, FileSpreadsheet, TriangleAlert } from 'lucide-react';
import {
  BulkActionModal,
  type BulkActionType,
} from '@/features/mall/bulk/components/bulk-action-modal';
import { BulkPolicyModal } from '@/features/mall/bulk/components/bulk-policy-modal';
import { SelectedProductsModal } from '../selected-products-modal';
import { ProductsListFilterBox } from '../filter-box';
import { ExcelDownloadMenu } from '../excel-download';
import { PageSizeSelect } from './page-size-select';

export function ProductsListTable() {
  const router = useRouter();
  const requestFormExport = useRequestFormExport();
  const [modalAction, setModalAction] = useState<BulkActionType | null>(null);
  const [policyOpen, setPolicyOpen] = useState(false);

  const { searchParams: query, pageSize } = useProductsListTableQuery();
  const { data, isLoading, isFetching } = useMastersSummary(query);
  const totalCount = data?.total ?? 0;

  const searchParams = useSearchParams();
  const masterSelection = useMasterSelection();
  const selectAllGate = canSelectAll({
    hasFilter: hasActiveFilter(searchParams),
    total: totalCount,
  });
  const selectAllReasonId = useId();
  const currentSignature = filterSignature(searchParams);

  const columns = useProductsListTableColumns({
    totalCount,
    pageIndex: (query.page ?? 1) - 1,
    pageSize,
  });

  const { table } = useDataTable({
    data: data?.data ?? [],
    columns,
    count: data?.total,
    pageSize,
    getRowId: (row) => row.masterId,
    enableRowSelection: true,
  });

  const [selectedItems, setSelectedItems] = useState<
    Record<string, SelectedProductSnapshot>
  >({});

  const rowSelection = table.getState().rowSelection;
  const selectedIds = selectedIdsFromRowSelection(rowSelection);
  const hasSelection = selectedIds.length > 0;

  // 스냅샷(selectedItems)은 effect 로 한 틱 늦게 갱신되므로, 표시용 목록은 현재
  // 선택 상태로 즉시 필터해 개별 해제가 프레임 지연 없이 반영되도록 한다.
  const selectedItemsList = Object.values(selectedItems).filter(
    (it) => rowSelection[it.masterId]
  );

  // 선택되는 순간 그 행은 반드시 현재 페이지에 로드돼 있으므로,
  // 이름/썸네일 스냅샷을 담아 교차 페이지/필터에서도 목록을 보여줄 수 있게 한다.
  useEffect(() => {
    const currentRows: SelectedProductSnapshot[] = (data?.data ?? []).map(
      (r) => ({
        masterId: r.masterId,
        name: r.name,
        thumbnail: r.thumbnail ?? null,
        hideMembershipPriceForNonMembers: r.hideMembershipPriceForNonMembers,
        isVisibleToMembersOnly: r.isVisibleToMembersOnly,
        isOverseas: r.isOverseas,
      })
    );
    setSelectedItems((prev) => {
      const { changed, next } = reconcileSelectedSnapshots(
        prev,
        rowSelection,
        currentRows
      );
      return changed ? next : prev;
    });
  }, [rowSelection, data]);

  // 선택이 담긴 시점의 필터 서명들. 필터를 바꾼 뒤에도 남아 있는 선택을 경고하기 위한
  // 유일한 근거이므로 **선택이 늘어난 순간에만** 기록한다 — 필터가 바뀌었다는 이유로
  // 서명을 더하면 아무도 새로 고르지 않았는데 경고가 뜬다.
  const [selectionSignatures, setSelectionSignatures] = useState<string[]>([]);
  const prevSelectedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const prev = prevSelectedIdsRef.current;
    const grew = selectedIds.some((id) => !prev.has(id));
    prevSelectedIdsRef.current = new Set(selectedIds);

    if (selectedIds.length === 0) {
      setSelectionSignatures((s) => (s.length === 0 ? s : []));
      return;
    }
    if (grew) {
      setSelectionSignatures((s) =>
        s.includes(currentSignature) ? s : [...s, currentSignature]
      );
    }
    // selectedIds 는 rowSelection 에서 파생된 값이라 rowSelection 만 보면 된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowSelection, currentSignature]);

  // 선택이 이번 렌더에서 막 생겼으면 위 effect 가 아직 서명을 기록하기 전이다. 그 한
  // 프레임 동안 경고가 번쩍이지 않도록 현재 서명을 채워 준다 — 기록이 비어 있는 유일한
  // 경우가 "이번 렌더에 현재 필터로 고른 것" 이라 사실과 어긋나지 않는다.
  const effectiveSignatures =
    hasSelection && selectionSignatures.length === 0
      ? [currentSignature]
      : selectionSignatures;

  const staleness = selectionStaleness({
    signatures: effectiveSignatures,
    currentSignature,
    selectedCount: selectedIds.length,
  });

  function handleSuccess() {
    table.resetRowSelection();
    setSelectedItems({});
  }

  return (
    <div>
      <ProductsListFilterBox />

      <DataTable
        table={table}
        isLoading={isLoading}
        isFetching={isFetching}
        count={totalCount}
        pageSize={pageSize}
        variant="grid"
        orderBy={[
          { key: 'createdAt', label: '등록일' },
          { key: 'name', label: '상품명' },
          { key: 'updatedAt', label: '수정일' },
        ]}
        toolbar={
          <div className="flex flex-wrap items-center gap-2 py-2">
            <span className="mr-1 text-sm font-medium">
              총 {totalCount.toLocaleString()}건
            </span>
            <PageSizeSelect />
            <SelectedProductsModal
              items={selectedItemsList}
              count={selectedIds.length}
              onRemove={(masterId) =>
                table.setRowSelection((prev) => {
                  const next = { ...prev };
                  delete next[masterId];
                  return next;
                })
              }
              onClearAll={() => table.resetRowSelection()}
            />
            {staleness.stale && (
              <Badge variant="destructive" className="whitespace-normal">
                <TriangleAlert />
                {staleness.message}
              </Badge>
            )}
            {/* Button 은 disabled 일 때 pointer-events:none 이라 자기 title 로는
                툴팁이 뜨지 않는다. 비활성 사유는 hit-test 되는 span 이 들고 있는다. */}
            <span title={selectAllGate.reason} className="inline-flex">
              <Button
                size="sm"
                variant="outline"
                disabled={!selectAllGate.ok || masterSelection.isPending}
                aria-describedby={
                  selectAllGate.ok ? undefined : selectAllReasonId
                }
                onClick={() => {
                  // 화면이 보고 있는 것과 **같은 필터 객체**를 그대로 넘긴다 —
                  // 새로 조립하면 목록과 선택이 어긋난다.
                  masterSelection.mutate(query, {
                    onSuccess: (res) => {
                      const { rowSelection: next, snapshots } =
                        selectionFromItems(res.items);
                      // 이 두 줄의 순서와 "통째 교체"는 불변식이다. setSelectedItems 를
                      // prev 병합(`{...prev, ...snapshots}`)으로 바꾸거나 setRowSelection
                      // 보다 앞에 두면, 재조정 effect 가 prev 스냅샷을 못 찾아
                      // 정책 플래그가 전부 false 로 떨어지고 일괄 정책 모달이
                      // 틀린 건수를 보고한다. (선택 자체가 교체이므로 서명도 교체한다.)
                      table.setRowSelection(next);
                      setSelectedItems(snapshots);
                      setSelectionSignatures([currentSignature]);
                      toast.success(
                        `${res.total.toLocaleString()}건을 선택했습니다.`
                      );
                    },
                    onError: (error) =>
                      toast.error(
                        parseServerError(error, '전체 선택에 실패했습니다.')
                          .message
                      ),
                  });
                }}
              >
                {masterSelection.isPending
                  ? '선택하는 중…'
                  : `필터 결과 전체 선택${selectAllGate.ok ? ` (${totalCount.toLocaleString()})` : ''}`}
              </Button>
            </span>
            {/* 비활성 버튼은 포커스를 못 받고 wrapper 의 title 도 읽히지 않는다.
                사유를 보이는 텍스트로 두고 버튼과 aria 로 연결한다. */}
            {!selectAllGate.ok && selectAllGate.reason && (
              <span
                id={selectAllReasonId}
                className="text-xs text-muted-foreground"
              >
                {selectAllGate.reason}
              </span>
            )}
            <ExcelDownloadMenu
              selectedIds={selectedIds}
              totalCount={totalCount}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!hasSelection || requestFormExport.isPending}
              onClick={() => {
                // window.open 은 사용자 제스처 핸들러 안에서 **동기적으로** 불러야
                // 팝업 차단에 안 걸린다. POST 응답을 기다렸다 열면 차단되므로 창을
                // 먼저 열고 요청은 이 탭에서 보낸다. 새 탭은 목록을 폴링하므로
                // 접수된 잡이 곧 나타난다.
                const opened = window.open(
                  '/mall/bulk-sessions?tab=forms',
                  '_blank'
                );
                if (!opened) {
                  toast.info('팝업이 차단되어 이 탭에서 엽니다.');
                  router.push('/mall/bulk-sessions?tab=forms');
                }
                requestFormExport.mutate(selectedIds, {
                  onSuccess: (res) =>
                    toast.success(
                      res.reused
                        ? '이미 진행 중인 같은 요청이 있어 그것으로 이어집니다.'
                        : '양식 생성을 접수했습니다. 새 탭에서 진행 상황을 확인하세요.'
                    ),
                  onError: (error) =>
                    toast.error(
                      parseServerError(error, '양식 생성 요청에 실패했습니다.')
                        .message
                    ),
                });
              }}
            >
              <FileSpreadsheet className="w-3 h-3 mr-1" />
              양식 다운로드
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!hasSelection}
              onClick={() => setModalAction('status')}
            >
              선택 상품상태변경
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!hasSelection}
              onClick={() => setPolicyOpen(true)}
            >
              운영 노출 정책 변경
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={!hasSelection}
              onClick={() => setModalAction('delete')}
            >
              <Trash2 className="w-3 h-3 mr-1" />
              선택 삭제
            </Button>
          </div>
        }
        rowClassName={(row) =>
          row.original.status === 'draft' ? 'bg-[#fdf1f1]' : undefined
        }
        navigateTo={(row) =>
          // active 버전이 없는 상품은 GET /masters/:id 가 404 — versionId 로 직접 조회한다.
          row.original.status === 'active'
            ? `/mall/products-list/${row.original.masterId}`
            : `/mall/products-list/${row.original.masterId}?versionId=${row.original.versionId}`
        }
        noRecords={{ message: '상품 데이터가 없습니다.' }}
      />

      {/* 툴바 배지만으로는 부족하다 — 확인 모달이 열리면 툴바는 오버레이 뒤로 가려지고,
          최대 5,000건을 지우기 직전의 마지막 관문은 모달이다. 같은 경고를 그 안에도 싣는다. */}
      <BulkActionModal
        open={modalAction !== null}
        onOpenChange={(open) => !open && setModalAction(null)}
        action={modalAction}
        selectedIds={selectedIds}
        selectedItems={selectedItemsList}
        staleWarning={staleness.stale ? staleness.message : null}
        onSuccess={handleSuccess}
      />

      <BulkPolicyModal
        open={policyOpen}
        onOpenChange={setPolicyOpen}
        selectedIds={selectedIds}
        selectedItems={selectedItemsList}
        staleWarning={staleness.stale ? staleness.message : null}
        onSuccess={handleSuccess}
      />
    </div>
  );
}
