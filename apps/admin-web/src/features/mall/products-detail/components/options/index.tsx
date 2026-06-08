'use client';

import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { CardErrorBoundary } from '@/components/admin-ui-experimental/common/card-error-boundary';
import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { useUpdateMasterVersion } from '@/lib/services/products/mutations';
import { useProductDetailSuspense } from '@/lib/services/products/use-product-detail';
import type { ProductDetailView } from '@/lib/services/products/use-product-detail';
import {
  canEditProductOptions,
  createNewOptionGroup,
  createNewOptionValue,
  toProductOptionsFormValues,
  toProductOptionsUpdateDto,
  type ProductOptionGroupFormRow,
  type ProductOptionValueFormRow,
  type ProductOptionsFormValues,
} from './product-options-model';

type Props = { masterId: string; versionId: string | null };

function toSortOrder(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ProductOptionsEditDialog({
  masterId,
  detail,
  open,
  onOpenChange,
}: {
  masterId: string;
  detail: ProductDetailView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const updateVersion = useUpdateMasterVersion();
  const [values, setValues] = useState<ProductOptionsFormValues>(() =>
    toProductOptionsFormValues(detail)
  );

  useEffect(() => {
    if (open) {
      setValues(toProductOptionsFormValues(detail));
    }
  }, [open, detail]);

  const busy = updateVersion.isPending;

  const handleOpenChange = (nextOpen: boolean) => {
    if (busy) return;
    onOpenChange(nextOpen);
  };

  const setGroup = (
    groupIndex: number,
    patch: Partial<ProductOptionGroupFormRow>
  ) => {
    setValues((current) => ({
      groups: current.groups.map((group, index) =>
        index === groupIndex ? { ...group, ...patch } : group
      ),
    }));
  };

  const setValue = (
    groupIndex: number,
    valueIndex: number,
    patch: Partial<ProductOptionValueFormRow>
  ) => {
    setValues((current) => ({
      groups: current.groups.map((group, index) => {
        if (index !== groupIndex) return group;

        return {
          ...group,
          values: group.values.map((value, currentValueIndex) =>
            currentValueIndex === valueIndex ? { ...value, ...patch } : value
          ),
        };
      }),
    }));
  };

  const addGroup = () => {
    setValues((current) => ({
      groups: [...current.groups, createNewOptionGroup(current.groups)],
    }));
  };

  const removeGroup = (groupIndex: number) => {
    setValues((current) => ({
      groups: current.groups.filter((_, index) => index !== groupIndex),
    }));
  };

  const addValue = (groupIndex: number) => {
    setValues((current) => ({
      groups: current.groups.map((group, index) =>
        index === groupIndex
          ? {
              ...group,
              values: [...group.values, createNewOptionValue(group.values)],
            }
          : group
      ),
    }));
  };

  const removeValue = (groupIndex: number, valueIndex: number) => {
    setValues((current) => ({
      groups: current.groups.map((group, index) => {
        if (index !== groupIndex || group.values.length <= 1) return group;

        return {
          ...group,
          values: group.values.filter(
            (_, currentValueIndex) => currentValueIndex !== valueIndex
          ),
        };
      }),
    }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!detail.versionId || busy) return;

    let dto: ReturnType<typeof toProductOptionsUpdateDto>;
    try {
      dto = toProductOptionsUpdateDto(detail.optionGroups, values);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : '옵션 입력값을 확인해주세요.'
      );
      return;
    }

    updateVersion.mutate(
      {
        masterId,
        versionId: detail.versionId,
        dto,
      },
      {
        onSuccess: () => {
          toast.success('옵션을 저장했습니다.');
          onOpenChange(false);
        },
        onError: (error) => {
          toast.error(
            error instanceof Error ? error.message : '옵션 저장에 실패했습니다.'
          );
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="grid max-h-[90vh] max-w-[calc(100%-2rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-4xl"
        showCloseButton={!busy}
      >
        <form onSubmit={handleSubmit} className="contents">
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle>옵션 수정</DialogTitle>
            <DialogDescription>
              draft version의 옵션 그룹과 옵션 값을 수정합니다.
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-col">
            <div className="flex flex-1 flex-col gap-4 overflow-auto px-6 py-4">
              <Alert className="border-amber-200 bg-amber-50 text-amber-900">
                <AlertTriangle />
                <AlertTitle>옵션 구조 변경 주의</AlertTitle>
                <AlertDescription>
                  옵션 그룹이나 값을 추가, 삭제, 변경하면 품목 조합이 다시
                  생성될 수 있습니다.
                </AlertDescription>
              </Alert>

              <div className="flex flex-col gap-3">
                {values.groups.length === 0 ? (
                  <div className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                    옵션 그룹 없음
                  </div>
                ) : (
                  values.groups.map((group, groupIndex) => (
                    <div
                      key={group.clientId}
                      className="flex flex-col gap-4 rounded-md border p-4"
                    >
                      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_8rem_auto]">
                        <div className="flex flex-col gap-2">
                          <Label htmlFor={`${group.clientId}-name`}>
                            옵션 그룹명
                          </Label>
                          <Input
                            id={`${group.clientId}-name`}
                            value={group.displayName}
                            onChange={(event) =>
                              setGroup(groupIndex, {
                                displayName: event.target.value,
                              })
                            }
                            disabled={busy}
                            placeholder="예: 색상"
                          />
                        </div>
                        <div className="flex flex-col gap-2">
                          <Label htmlFor={`${group.clientId}-sort`}>정렬</Label>
                          <Input
                            id={`${group.clientId}-sort`}
                            type="number"
                            min={0}
                            value={group.sortOrder}
                            onChange={(event) =>
                              setGroup(groupIndex, {
                                sortOrder: toSortOrder(event.target.value),
                              })
                            }
                            disabled={busy}
                          />
                        </div>
                        <div className="flex items-end">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => removeGroup(groupIndex)}
                          >
                            <Trash2 data-icon="inline-start" />
                            삭제
                          </Button>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-medium">옵션 값</div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => addValue(groupIndex)}
                          >
                            <Plus data-icon="inline-start" />값 추가
                          </Button>
                        </div>

                        {group.values.length === 0 ? (
                          <div className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                            옵션 값 없음
                          </div>
                        ) : (
                          <div className="flex flex-col gap-2">
                            {group.values.map((value, valueIndex) => (
                              <div
                                key={value.clientId}
                                className="grid gap-2 rounded-md bg-muted/40 p-2 md:grid-cols-[minmax(0,1fr)_8rem_auto]"
                              >
                                <Input
                                  value={value.displayName}
                                  onChange={(event) =>
                                    setValue(groupIndex, valueIndex, {
                                      displayName: event.target.value,
                                    })
                                  }
                                  disabled={busy}
                                  placeholder="예: 레드"
                                  aria-label={`${group.displayName || '옵션'} 값 이름`}
                                />
                                <Input
                                  type="number"
                                  min={0}
                                  value={value.sortOrder}
                                  onChange={(event) =>
                                    setValue(groupIndex, valueIndex, {
                                      sortOrder: toSortOrder(
                                        event.target.value
                                      ),
                                    })
                                  }
                                  disabled={busy}
                                  aria-label={`${group.displayName || '옵션'} 값 정렬`}
                                />
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={busy || group.values.length <= 1}
                                  onClick={() =>
                                    removeValue(groupIndex, valueIndex)
                                  }
                                >
                                  <Trash2 data-icon="inline-start" />
                                  삭제
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>

              <Button
                type="button"
                size="sm"
                variant="outline"
                className="self-start"
                disabled={busy}
                onClick={addGroup}
              >
                <Plus data-icon="inline-start" />
                옵션 그룹 추가
              </Button>
            </div>

            <DialogFooter className="border-t px-6 py-4">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => onOpenChange(false)}
              >
                취소
              </Button>
              <Button type="submit" disabled={busy || !detail.versionId}>
                {busy ? (
                  <Spinner size="sm" />
                ) : (
                  <Save data-icon="inline-start" />
                )}
                {busy ? '저장 중...' : '저장'}
              </Button>
            </DialogFooter>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProductDetailOptionsContent({ masterId, versionId }: Props) {
  const { data } = useProductDetailSuspense(masterId, versionId);
  const groups = data.optionGroups;
  const [editOpen, setEditOpen] = useState(false);
  const canEdit = canEditProductOptions(data);

  return (
    <>
      <Header
        title="옵션"
        subtitle={
          !canEdit
            ? '옵션은 draft version에서만 수정할 수 있습니다.'
            : undefined
        }
        right={
          canEdit ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditOpen(true)}
            >
              <Pencil data-icon="inline-start" />
              수정
            </Button>
          ) : null
        }
      />
      {groups.length === 0 ? (
        <div className="p-3 text-sm text-gray-500">옵션 없음</div>
      ) : (
        <div className="divide-y">
          {groups.map((group) => (
            <div key={group.id} className="grid grid-cols-2 p-3">
              <div className="text-sm font-medium text-gray-500">
                {group.displayName}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {group.values.map((v) => (
                  <Badge key={v.id} variant="outline">
                    {v.displayName}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {canEdit && (
        <ProductOptionsEditDialog
          masterId={masterId}
          detail={data}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      )}
    </>
  );
}

export function ProductDetailOptions({ masterId, versionId }: Props) {
  return (
    <Container>
      <CardErrorBoundary>
        <Suspense
          fallback={
            <>
              <Header title="옵션" />
              <div className="flex justify-center p-4">
                <Spinner />
              </div>
            </>
          }
        >
          <ProductDetailOptionsContent
            masterId={masterId}
            versionId={versionId}
          />
        </Suspense>
      </CardErrorBoundary>
    </Container>
  );
}
