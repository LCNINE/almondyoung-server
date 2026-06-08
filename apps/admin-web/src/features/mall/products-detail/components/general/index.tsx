'use client';

import { Suspense, useEffect, useMemo, useState, type FormEvent } from 'react';
import { FolderTree, Pencil, Save } from 'lucide-react';
import { toast } from 'sonner';
import { CardErrorBoundary } from '@/components/admin-ui-experimental/common/card-error-boundary';
import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useUpdateMasterVersion } from '@/lib/services/products/mutations';
import { useCategoryTree } from '@/lib/services/products/queries';
import {
  useProductDetailSuspense,
  type ProductDetailView,
} from '@/lib/services/products/use-product-detail';
import {
  canEditBasicInformation,
  flattenCategoryTree,
  formatSelectedCategories,
  toBasicInformationFormValues,
  toBasicInformationUpdateDto,
  type BasicInformationFormValues,
  type SelectableCategory,
} from './basic-information-model';
import { ProductCategorySelectionModal } from './category-selection-modal';

const STATUS_LABELS: Record<string, string> = {
  active: '활성',
  inactive: '판매중단',
  draft: '임시저장',
  archived: '보관',
};

function formatBool(v: boolean | null): string {
  if (v === null) return '-';
  return v ? '예' : '아니오';
}

function formatStatus(s: string | null): string {
  if (!s) return '-';
  return STATUS_LABELS[s] ?? s;
}

function formatSeoKeywords(values: string[] | null): string {
  if (!values?.length) return '-';
  return values.join(', ');
}

function labelByCategoryId(
  options: SelectableCategory[],
  id: string
): string | null {
  return options.find((option) => option.id === id)?.pathLabel ?? null;
}

type Props = { masterId: string; versionId: string | null };

function ProductBasicInformationEditDrawer({
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
  const [values, setValues] = useState<BasicInformationFormValues>(() =>
    toBasicInformationFormValues(detail)
  );
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const { data: categoryTree, isLoading: categoriesLoading } = useCategoryTree({
    includeInactive: true,
  });
  const categoryOptions = useMemo(
    () => flattenCategoryTree(categoryTree?.categories ?? []),
    [categoryTree?.categories]
  );
  const selectedCategorySummary = useMemo(() => {
    const fallbackLabels = new Map(
      detail.categories.map((category) => [category.id, category.name])
    );
    const labels = values.categoryIds.map(
      (id) =>
        labelByCategoryId(categoryOptions, id) ?? fallbackLabels.get(id) ?? id
    );
    return labels.length > 0 ? labels.join(', ') : '-';
  }, [categoryOptions, detail.categories, values.categoryIds]);
  const primaryCategoryLabel = values.primaryCategoryId
    ? (labelByCategoryId(categoryOptions, values.primaryCategoryId) ??
      detail.categories.find(
        (category) => category.id === values.primaryCategoryId
      )?.name ??
      null)
    : null;

  useEffect(() => {
    if (open) {
      setValues(toBasicInformationFormValues(detail));
    }
  }, [open, detail]);

  const nameIsInvalid = values.name.trim().length === 0;
  const canSubmit =
    Boolean(detail.versionId) && !nameIsInvalid && !updateVersion.isPending;

  const setValue = <K extends keyof BasicInformationFormValues>(
    key: K,
    value: BasicInformationFormValues[K]
  ) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (updateVersion.isPending) return;
    onOpenChange(nextOpen);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!detail.versionId || !canSubmit) return;

    updateVersion.mutate(
      {
        masterId,
        versionId: detail.versionId,
        dto: toBasicInformationUpdateDto(values),
      },
      {
        onSuccess: () => {
          toast.success('기본 정보를 저장했습니다.');
          onOpenChange(false);
        },
        onError: (error) => {
          toast.error(
            error instanceof Error
              ? error.message
              : '기본 정보 저장에 실패했습니다.'
          );
        },
      }
    );
  };

  return (
    <>
      <Drawer open={open} onOpenChange={handleOpenChange} direction="right">
        <DrawerContent>
          <form onSubmit={handleSubmit} className="flex h-full flex-col">
            <DrawerHeader>
              <DrawerTitle>기본 정보 수정</DrawerTitle>
              <DrawerDescription>
                draft version의 상품명, 브랜드, SEO, 카테고리, 구매 제한
                플래그를 수정합니다.
              </DrawerDescription>
            </DrawerHeader>

            <div className="flex flex-1 flex-col gap-4 overflow-auto px-4 pb-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="product-basic-name">상품명</Label>
                <Input
                  id="product-basic-name"
                  value={values.name}
                  onChange={(event) => setValue('name', event.target.value)}
                  aria-invalid={nameIsInvalid}
                  disabled={updateVersion.isPending}
                />
                {nameIsInvalid && (
                  <p className="text-sm text-destructive">
                    상품명은 비워둘 수 없습니다.
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="product-basic-brand">브랜드</Label>
                <Input
                  id="product-basic-brand"
                  value={values.brand}
                  onChange={(event) => setValue('brand', event.target.value)}
                  placeholder="브랜드명을 입력하세요."
                  disabled={updateVersion.isPending}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="product-basic-seo-title">SEO 제목</Label>
                <Input
                  id="product-basic-seo-title"
                  value={values.seoTitle}
                  onChange={(event) => setValue('seoTitle', event.target.value)}
                  placeholder="검색 결과에 노출할 제목"
                  disabled={updateVersion.isPending}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="product-basic-seo-description">SEO 설명</Label>
                <Textarea
                  id="product-basic-seo-description"
                  value={values.seoDescription}
                  onChange={(event) =>
                    setValue('seoDescription', event.target.value)
                  }
                  placeholder="검색 결과에 노출할 설명"
                  disabled={updateVersion.isPending}
                  className="min-h-24"
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="product-basic-seo-keywords">SEO 키워드</Label>
                <Input
                  id="product-basic-seo-keywords"
                  value={values.seoKeywordsText}
                  onChange={(event) =>
                    setValue('seoKeywordsText', event.target.value)
                  }
                  placeholder="쉼표 또는 줄바꿈으로 구분"
                  disabled={updateVersion.isPending}
                />
              </div>

              <div className="flex flex-col gap-3 rounded-md border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <Label>카테고리</Label>
                    <p className="line-clamp-2 text-sm text-muted-foreground">
                      {selectedCategorySummary}
                    </p>
                    {primaryCategoryLabel && (
                      <p className="text-sm text-muted-foreground">
                        대표: {primaryCategoryLabel}
                      </p>
                    )}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={updateVersion.isPending}
                    onClick={() => setCategoryModalOpen(true)}
                  >
                    <FolderTree data-icon="inline-start" />
                    선택
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-3 rounded-md border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="product-basic-wholesale">도매 전용</Label>
                    <p className="text-sm text-muted-foreground">
                      도매 운영 대상 상품으로 제한합니다.
                    </p>
                  </div>
                  <Switch
                    id="product-basic-wholesale"
                    checked={values.isWholesaleOnly}
                    onCheckedChange={(checked) =>
                      setValue('isWholesaleOnly', checked)
                    }
                    disabled={updateVersion.isPending}
                  />
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="product-basic-membership">
                      멤버십 전용
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      멤버십 회원 대상 상품으로 제한합니다.
                    </p>
                  </div>
                  <Switch
                    id="product-basic-membership"
                    checked={values.isMembershipOnly}
                    onCheckedChange={(checked) =>
                      setValue('isMembershipOnly', checked)
                    }
                    disabled={updateVersion.isPending}
                  />
                </div>
              </div>
            </div>

            <DrawerFooter className="border-t sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                disabled={updateVersion.isPending}
                onClick={() => onOpenChange(false)}
              >
                취소
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {updateVersion.isPending ? (
                  <Spinner size="sm" />
                ) : (
                  <Save data-icon="inline-start" />
                )}
                {updateVersion.isPending ? '저장 중...' : '저장'}
              </Button>
            </DrawerFooter>
          </form>
        </DrawerContent>
      </Drawer>
      <ProductCategorySelectionModal
        open={categoryModalOpen}
        onOpenChange={setCategoryModalOpen}
        options={categoryOptions}
        isLoading={categoriesLoading}
        selectedIds={values.categoryIds}
        primaryCategoryId={values.primaryCategoryId}
        disabled={updateVersion.isPending}
        onApply={(categoryIds, primaryCategoryId) => {
          setValues((current) => ({
            ...current,
            categoryIds,
            primaryCategoryId,
          }));
        }}
      />
    </>
  );
}

function ProductDetailGeneralContent({ masterId, versionId }: Props) {
  const { data } = useProductDetailSuspense(masterId, versionId);
  const [editOpen, setEditOpen] = useState(false);
  const canEdit = canEditBasicInformation(data);

  const rows: { key: string; value: string }[] = [
    { key: '이름', value: data.name },
    { key: '브랜드', value: data.brand ?? '-' },
    { key: '상태', value: formatStatus(data.status) },
    { key: '도매 전용', value: formatBool(data.isWholesaleOnly) },
    { key: '멤버십 전용', value: formatBool(data.isMembershipOnly) },
    { key: 'SEO 제목', value: data.seoTitle ?? '-' },
    { key: 'SEO 설명', value: data.seoDescription ?? '-' },
    { key: 'SEO 키워드', value: formatSeoKeywords(data.seoKeywords) },
    { key: '카테고리', value: formatSelectedCategories(data.categories) },
    { key: '등록일', value: data.createdAt },
    { key: '수정일', value: data.updatedAt },
  ];

  return (
    <>
      <Header
        title="기본 정보"
        subtitle={
          !canEdit
            ? '기본 정보는 draft version에서만 수정할 수 있습니다.'
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
      <div className="divide-y">
        {rows.map(({ key, value }) => (
          <div key={key} className="grid grid-cols-2 p-3">
            <div className="text-sm font-medium text-gray-500">{key}</div>
            <div className="text-sm">{value}</div>
          </div>
        ))}
      </div>
      {canEdit && (
        <ProductBasicInformationEditDrawer
          masterId={masterId}
          detail={data}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      )}
    </>
  );
}

export function ProductDetailGeneral({ masterId, versionId }: Props) {
  return (
    <Container>
      <CardErrorBoundary>
        <Suspense
          fallback={
            <>
              <Header title="기본 정보" />
              <div className="flex justify-center p-4">
                <Spinner />
              </div>
            </>
          }
        >
          <ProductDetailGeneralContent
            masterId={masterId}
            versionId={versionId}
          />
        </Suspense>
      </CardErrorBoundary>
    </Container>
  );
}
