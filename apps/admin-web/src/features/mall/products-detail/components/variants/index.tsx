'use client';

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';
import { CardErrorBoundary } from '@/components/admin-ui-experimental/common/card-error-boundary';
import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { Spinner } from '@/components/ui/spinner';
import { DataTable } from '@/components/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import {
  useProductVariantsTableColumns,
  type ProductVariantTableRow,
} from '@/hooks/table/columns/use-product-variants-table-columns';
import { useQueryParams } from '@/hooks/use-query-params';
import {
  useVariantsByMasterSuspense,
  useVariantsByMasterVersionSuspense,
} from '@/lib/services/products/queries';
import { useProductDetailSuspense } from '@/lib/services/products/use-product-detail';
import type {
  ProductVariantRow,
  ProductVariantStatus,
} from '@/lib/services/products/products-detail.types';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useBulkUpdateDraftVariants,
  useUpdateDraftVariant,
} from '@/lib/services/products/mutations';
import {
  matchingQueryKeys,
  normalizeStockPolicy,
  useUpdateVariantStockPolicy,
  useVariantMatchingBatch,
} from '@/lib/services/matching';
import { useQueryClient } from '@tanstack/react-query';
import type {
  StockPolicyDto,
  VariantMatchingBatchItemDto,
} from '@/lib/types/dto/matching';
import { VariantMatchingPanel } from '@/features/matching/products/components/variant-editor-dialog';
import {
  canEditProductVariants,
  toBulkProductVariantUpdateDto,
  toProductVariantFormValues,
  toProductVariantUpdateDto,
  type ProductVariantFormValues,
} from './product-variants-model';
import { Save } from 'lucide-react';
import { toast } from 'sonner';

const PAGE_SIZE = 100;

type Props = { masterId: string; versionId: string | null };

const STATUS_OPTIONS: Array<{ value: ProductVariantStatus; label: string }> = [
  { value: 'active', label: '활성' },
  { value: 'inactive', label: '판매중단' },
];

function isInvalidDisplayOrder(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  const parsed = Number(trimmed);
  return !Number.isInteger(parsed) || parsed < 0;
}

function getPage(value: string | undefined): number {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function getVariantDisplayName(variant: ProductVariantRow): string {
  return variant.variantName ?? variant.id;
}

function mergeMatchingInfo(
  rows: ProductVariantRow[],
  matchingItems: VariantMatchingBatchItemDto[] | undefined
): ProductVariantTableRow[] {
  const matchingByVariantId = new Map(
    (matchingItems ?? []).map((item) => [item.variantId, item])
  );
  return rows.map((row) => ({
    ...row,
    matchingInfo: matchingByVariantId.get(row.id),
  }));
}

function ProductVariantEditDrawer({
  masterId,
  versionId,
  variant,
  open,
  onOpenChange,
}: {
  masterId: string;
  versionId: string;
  variant: ProductVariantRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const updateVariant = useUpdateDraftVariant();
  const [values, setValues] = useState<ProductVariantFormValues>(() =>
    toProductVariantFormValues(variant)
  );

  useEffect(() => {
    if (open) {
      setValues(toProductVariantFormValues(variant));
    }
  }, [open, variant]);

  const displayOrderIsInvalid = isInvalidDisplayOrder(values.displayOrder);
  const canSubmit =
    Boolean(versionId) && !displayOrderIsInvalid && !updateVariant.isPending;

  const setValue = <K extends keyof ProductVariantFormValues>(
    key: K,
    value: ProductVariantFormValues[K]
  ) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (updateVariant.isPending) return;
    onOpenChange(nextOpen);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!versionId || !canSubmit) return;

    let dto;
    try {
      dto = toProductVariantUpdateDto(variant, values);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : '품목 입력값을 확인하세요.'
      );
      return;
    }
    if (Object.keys(dto).length === 0) {
      toast.info('변경된 품목 정보가 없습니다.');
      return;
    }

    updateVariant.mutate(
      {
        masterId,
        versionId,
        variantId: variant.id,
        dto,
      },
      {
        onSuccess: () => {
          toast.success('품목을 저장했습니다.');
          onOpenChange(false);
        },
        onError: (error) => {
          toast.error(
            error instanceof Error ? error.message : '품목 저장에 실패했습니다.'
          );
        },
      }
    );
  };

  return (
    <Drawer open={open} onOpenChange={handleOpenChange} direction="right">
      <DrawerContent>
        <form onSubmit={handleSubmit} className="flex h-full flex-col">
          <DrawerHeader>
            <DrawerTitle>품목 수정</DrawerTitle>
            <DrawerDescription>
              draft version 기준으로 품목 이름, 판매 상태, 표시 순서를
              수정합니다.
            </DrawerDescription>
          </DrawerHeader>

          <div className="flex flex-1 flex-col gap-4 overflow-auto px-4 pb-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="product-variant-name">품목 이름</Label>
              <Input
                id="product-variant-name"
                value={values.variantName}
                onChange={(event) =>
                  setValue('variantName', event.target.value)
                }
                disabled={updateVariant.isPending}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="product-variant-status">판매 상태</Label>
              <Select
                value={values.status}
                onValueChange={(value) =>
                  setValue('status', value as ProductVariantStatus)
                }
                disabled={updateVariant.isPending}
              >
                <SelectTrigger
                  id="product-variant-status"
                  className="h-8 text-sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="product-variant-display-order">표시 순서</Label>
              <Input
                id="product-variant-display-order"
                inputMode="numeric"
                value={values.displayOrder}
                onChange={(event) =>
                  setValue('displayOrder', event.target.value)
                }
                aria-invalid={displayOrderIsInvalid}
                disabled={updateVariant.isPending}
                placeholder="0"
              />
              {displayOrderIsInvalid && (
                <p className="text-sm text-destructive">
                  표시 순서를 입력하세요. 0 이상의 숫자만 사용할 수 있습니다.
                </p>
              )}
            </div>
          </div>

          <DrawerFooter className="border-t sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={updateVariant.isPending}
              onClick={() => onOpenChange(false)}
            >
              취소
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {updateVariant.isPending ? (
                <Spinner size="sm" />
              ) : (
                <Save data-icon="inline-start" />
              )}
              {updateVariant.isPending ? '저장 중...' : '저장'}
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}

function ProductVariantMatchingDrawer({
  masterId,
  variant,
  open,
  onOpenChange,
}: {
  masterId: string;
  variant: ProductVariantTableRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent className="sm:max-w-xl">
        <DrawerHeader>
          <DrawerTitle>매칭 편집</DrawerTitle>
          <DrawerDescription>
            {getVariantDisplayName(variant)}
          </DrawerDescription>
        </DrawerHeader>
        <ScrollArea className="min-h-0 flex-1 px-4 pb-4">
          <VariantMatchingPanel
            variantId={variant.id}
            variantName={getVariantDisplayName(variant)}
            masterId={masterId}
            onSaved={() => onOpenChange(false)}
          />
        </ScrollArea>
      </DrawerContent>
    </Drawer>
  );
}

function VariantsTable({
  masterId,
  versionId,
  rows,
  total,
  optionGroups,
  editable,
  showMatchingColumns,
  matchingBatchLoading,
}: {
  masterId: string;
  versionId: string | null;
  rows: ProductVariantTableRow[];
  total: number;
  optionGroups: ReturnType<
    typeof useProductDetailSuspense
  >['data']['optionGroups'];
  editable: boolean;
  showMatchingColumns: boolean;
  matchingBatchLoading: boolean;
}) {
  const [editingVariant, setEditingVariant] =
    useState<ProductVariantTableRow | null>(null);
  const [matchingEditingVariant, setMatchingEditingVariant] =
    useState<ProductVariantTableRow | null>(null);
  const [pendingPolicyVariantId, setPendingPolicyVariantId] = useState<
    string | null
  >(null);
  const bulkUpdateVariants = useBulkUpdateDraftVariants();
  const updateStockPolicy = useUpdateVariantStockPolicy();
  const queryClient = useQueryClient();
  const actions = useMemo(
    () => (editable ? { onEdit: setEditingVariant } : undefined),
    [editable]
  );

  const handlePolicyChange = useCallback(
    (row: ProductVariantTableRow, policy: StockPolicyDto) => {
      if (pendingPolicyVariantId) return;
      const normalized = normalizeStockPolicy(policy);
      setPendingPolicyVariantId(row.id);
      updateStockPolicy.mutate(
        {
          variantId: row.id,
          data: normalized,
        },
        {
          onError: (error) => {
            toast.error(
              error instanceof Error
                ? error.message
                : '재고 정책 저장에 실패했습니다.'
            );
            queryClient.invalidateQueries({
              queryKey: matchingQueryKeys.variantMatchingBatches(),
            });
          },
          onSettled: () => {
            setPendingPolicyVariantId(null);
          },
        }
      );
    },
    [pendingPolicyVariantId, queryClient, updateStockPolicy]
  );

  const matchingActions = useMemo(
    () =>
      showMatchingColumns
        ? {
            isLoading: matchingBatchLoading,
            pendingVariantId: pendingPolicyVariantId,
            onPolicyChange: handlePolicyChange,
            onEditMatching: setMatchingEditingVariant,
          }
        : undefined,
    [
      showMatchingColumns,
      matchingBatchLoading,
      pendingPolicyVariantId,
      handlePolicyChange,
    ]
  );

  const columns = useProductVariantsTableColumns(
    optionGroups,
    actions,
    matchingActions
  );

  const { table } = useDataTable({
    data: rows,
    columns,
    count: total,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.id,
    enableRowSelection: editable,
    prefix: 'variants',
  });

  const selectedRows = table
    .getSelectedRowModel()
    .rows.map((row) => row.original);
  const canBulkUpdate =
    editable &&
    Boolean(versionId) &&
    selectedRows.length > 0 &&
    !bulkUpdateVariants.isPending;

  const handleBulkStatusUpdate = (status: ProductVariantStatus) => {
    if (!versionId || !canBulkUpdate) return;
    const dto = toBulkProductVariantUpdateDto(selectedRows, { status });
    if (dto.updates.length === 0) {
      toast.info('변경할 품목이 없습니다.');
      return;
    }

    bulkUpdateVariants.mutate(
      {
        masterId,
        versionId,
        dto,
      },
      {
        onSuccess: () => {
          toast.success('선택한 품목을 저장했습니다.');
          table.resetRowSelection();
        },
        onError: (error) => {
          toast.error(
            error instanceof Error
              ? error.message
              : '선택 품목 저장에 실패했습니다.'
          );
        },
      }
    );
  };

  return (
    <>
      {editable && selectedRows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/50 p-3">
          <span className="text-sm text-muted-foreground">
            {selectedRows.length}개 선택됨
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={!canBulkUpdate}
            onClick={() => handleBulkStatusUpdate('active')}
          >
            선택 활성
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!canBulkUpdate}
            onClick={() => handleBulkStatusUpdate('inactive')}
          >
            선택 판매중단
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={bulkUpdateVariants.isPending}
            onClick={() => table.resetRowSelection()}
          >
            선택 해제
          </Button>
        </div>
      )}

      <DataTable
        table={table}
        count={total}
        pageSize={PAGE_SIZE}
        prefix="variants"
        noRecords={{ message: '품목이 없습니다.' }}
      />

      {editingVariant && versionId && (
        <ProductVariantEditDrawer
          masterId={masterId}
          versionId={versionId}
          variant={editingVariant}
          open={!!editingVariant}
          onOpenChange={(open) => {
            if (!open) setEditingVariant(null);
          }}
        />
      )}

      {matchingEditingVariant && (
        <ProductVariantMatchingDrawer
          masterId={masterId}
          variant={matchingEditingVariant}
          open={!!matchingEditingVariant}
          onOpenChange={(open) => {
            if (!open) setMatchingEditingVariant(null);
          }}
        />
      )}
    </>
  );
}

function VariantsFromMaster({ masterId }: { masterId: string }) {
  const { data: detail } = useProductDetailSuspense(masterId, null);
  const { page } = useQueryParams(['page'], 'variants');
  const currentPage = getPage(page);
  const { data: variants } = useVariantsByMasterSuspense(
    masterId,
    currentPage,
    PAGE_SIZE
  );
  const showMatchingColumns = detail.status === 'active';
  const variantIds = useMemo(
    () => variants.data.map((variant) => variant.id),
    [variants.data]
  );
  const matchingBatch = useVariantMatchingBatch(
    variantIds,
    showMatchingColumns
  );
  const rows = useMemo(
    () => mergeMatchingInfo(variants.data, matchingBatch.data?.data),
    [matchingBatch.data?.data, variants.data]
  );

  return (
    <VariantsTable
      masterId={masterId}
      versionId={null}
      rows={rows}
      total={variants.total}
      optionGroups={detail.optionGroups}
      editable={false}
      showMatchingColumns={showMatchingColumns}
      matchingBatchLoading={matchingBatch.isLoading || matchingBatch.isFetching}
    />
  );
}

function VariantsFromVersion({
  masterId,
  versionId,
}: {
  masterId: string;
  versionId: string;
}) {
  const { data: detail } = useProductDetailSuspense(masterId, versionId);
  const { page } = useQueryParams(['page'], 'variants');
  const currentPage = getPage(page);
  const { data: variants } = useVariantsByMasterVersionSuspense(
    masterId,
    versionId,
    currentPage,
    PAGE_SIZE
  );
  const showMatchingColumns = detail.status === 'active';
  const variantIds = useMemo(
    () => variants.data.map((variant) => variant.id),
    [variants.data]
  );
  const matchingBatch = useVariantMatchingBatch(
    variantIds,
    showMatchingColumns
  );
  const rows = useMemo(
    () => mergeMatchingInfo(variants.data, matchingBatch.data?.data),
    [matchingBatch.data?.data, variants.data]
  );

  return (
    <VariantsTable
      masterId={masterId}
      versionId={versionId}
      rows={rows}
      total={variants.total}
      optionGroups={detail.optionGroups}
      editable={canEditProductVariants(detail)}
      showMatchingColumns={showMatchingColumns}
      matchingBatchLoading={matchingBatch.isLoading || matchingBatch.isFetching}
    />
  );
}

function ProductDetailVariantsContent({ masterId, versionId }: Props) {
  if (versionId) {
    return <VariantsFromVersion masterId={masterId} versionId={versionId} />;
  }
  return <VariantsFromMaster masterId={masterId} />;
}

export function ProductDetailVariants({ masterId, versionId }: Props) {
  return (
    <Container>
      <Header title="품목 (Variants)" />
      <CardErrorBoundary>
        <Suspense
          fallback={
            <div className="flex justify-center p-4">
              <Spinner />
            </div>
          }
        >
          <ProductDetailVariantsContent
            masterId={masterId}
            versionId={versionId}
          />
        </Suspense>
      </CardErrorBoundary>
    </Container>
  );
}
