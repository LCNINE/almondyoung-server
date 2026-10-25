'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/common/form/form-field';
import { FormInput } from '@/components/common/form/form-input';
import { FormSelect } from '@/components/common/form/form-select';
import { FormSection } from '@/components/common/form/form-section';
import {
  useCreateSku,
  useUpdateSku,
  useSkuGroups,
  useDeliveryProfiles,
  useSuppliers,
} from '@/lib/services/inventory';
import { useSku } from '@/lib/services/inventory';
import type { SkuResponseDto, CreateSkuDto } from '@/lib/types/dto/inventory';
import { BarcodeListSection } from '../barcode-list-section';
import {
  deliveryProfileMissing,
  requiresDeliveryProfile,
} from '../../lib/delivery-profile-requirement';
import {
  directSupplierMissing,
  supplierIdsPayload,
} from '../../lib/direct-supplier-requirement';

const STOCK_TYPE_OPTIONS = [
  { value: 'physical', label: '사입' },
  { value: 'infinite', label: '무제한' },
  { value: 'drop_shipped', label: '직배' },
  { value: 'consignment', label: '위탁' },
];

// Radix SelectItem 은 value="" 를 금지한다. 폼 상태는 '' 을 「프로필 없음」으로 쓰므로,
// 화면 표시용으로만 이 센티널을 쓰고 onValueChange 에서 즉시 '' 로 되돌린다.
const NO_DELIVERY_PROFILE = '__none__';
const NO_DIRECT_SUPPLIER = '__none__';

type Props = {
  open: boolean;
  sku: SkuResponseDto | null;
  onOpenChange: (open: boolean) => void;
};

type FormState = {
  name: string;
  businessProductName: string;
  stockType: string;
  groupId: string;
  deliveryProfileId: string;
  directSupplierId: string;
};

const DEFAULT_FORM: FormState = {
  name: '',
  businessProductName: '',
  stockType: 'physical',
  groupId: '',
  deliveryProfileId: '',
  directSupplierId: '',
};

// 원래 직배 입점사 = SKU 에 연결된 공급사 중 직배 목록에 있는 첫 번째.
function originalDirectSupplierId(
  sku: SkuResponseDto,
  directSupplierIds: ReadonlySet<string>
): string {
  return sku.suppliers.find((s) => directSupplierIds.has(s.id))?.id ?? '';
}

function formFromSku(
  sku: SkuResponseDto,
  directSupplierIds: ReadonlySet<string>
): FormState {
  return {
    name: sku.name,
    businessProductName: sku.businessProductName ?? '',
    stockType: sku.stockType,
    groupId: sku.groupId ?? '',
    deliveryProfileId: sku.deliveryProfileId ?? '',
    directSupplierId: originalDirectSupplierId(sku, directSupplierIds),
  };
}

export function SkuFormDialog({ open, sku, onOpenChange }: Props) {
  const isEdit = !!sku;
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [errors, setErrors] = useState<
    Partial<Record<keyof FormState, string>>
  >({});

  const createMutation = useCreateSku();
  const updateMutation = useUpdateSku();
  const { data: groups } = useSkuGroups();
  const {
    data: profiles = [],
    isLoading: profilesLoading,
    isError: profilesError,
  } = useDeliveryProfiles();
  const {
    data: directSuppliers,
    isLoading: directSuppliersLoading,
    isError: directSuppliersError,
  } = useSuppliers({ isDirectDelivery: true, limit: 100 });
  const directList = directSuppliers?.data ?? [];
  const directSupplierIds = new Set(directList.map((s) => s.id));
  const originalDirectId = sku
    ? originalDirectSupplierId(sku, directSupplierIds)
    : '';
  const original = sku
    ? {
        stockType: sku.stockType,
        deliveryProfileId: sku.deliveryProfileId ?? '',
        directSupplierId: originalDirectId,
      }
    : null;

  // 편집 시 최신 SKU 데이터(바코드 포함) 가져오기
  const { data: freshSku } = useSku(sku?.id ?? '');

  useEffect(() => {
    if (open) {
      setForm(sku ? formFromSku(sku, directSupplierIds) : DEFAULT_FORM);
      setErrors({});
    }
    // 직배 목록이 늦게 와도 폼 입력을 덮지 않도록 목록 도착은 의존성에서 뺀다 — 아래 별도 효과가 빈 칸만 채운다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sku]);

  useEffect(() => {
    if (open && sku && originalDirectId) {
      setForm((prev) =>
        prev.directSupplierId
          ? prev
          : { ...prev, directSupplierId: originalDirectId }
      );
    }
  }, [open, sku, originalDirectId]);

  const set = (field: keyof FormState) => (value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const validate = (): boolean => {
    const next: typeof errors = {};
    if (!form.name.trim()) next.name = '이름은 필수입니다.';
    if (
      deliveryProfileMissing({
        original,
        stockType: form.stockType,
        deliveryProfileId: form.deliveryProfileId,
      })
    ) {
      next.deliveryProfileId = '사입·위탁 SKU 는 배송 프로필이 필요합니다.';
    }
    if (
      directSupplierMissing({
        original,
        stockType: form.stockType,
        directSupplierId: form.directSupplierId,
      })
    ) {
      next.directSupplierId = '직배 SKU 는 직배 입점사가 필요합니다.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    const profileChanged =
      form.deliveryProfileId !== (original?.deliveryProfileId ?? '');
    const payload: CreateSkuDto = {
      name: form.name.trim(),
      businessProductName: form.businessProductName || undefined,
      stockType: form.stockType as CreateSkuDto['stockType'],
      skuGroupId: form.groupId || undefined,
      // 수정에선 바뀌었을 때만 보낸다('' → null 은 지움). 생성에선 고른 값만.
      ...(isEdit
        ? profileChanged
          ? { deliveryProfileId: form.deliveryProfileId || null }
          : {}
        : form.deliveryProfileId
          ? { deliveryProfileId: form.deliveryProfileId }
          : {}),
      ...supplierIdsPayload({
        linkedSupplierIds: (sku?.suppliers ?? []).map((s) => s.id),
        directSupplierIds,
        originalDirectSupplierId: originalDirectId,
        directSupplierId: form.directSupplierId,
        stockType: form.stockType,
      }),
    };

    try {
      if (isEdit) {
        await updateMutation.mutateAsync({ id: sku.id, data: payload });
        toast.success('SKU가 수정되었습니다.');
      } else {
        await createMutation.mutateAsync(payload);
        toast.success('SKU가 생성되었습니다.');
      }
      onOpenChange(false);
    } catch (e: any) {
      if (e?.response?.data?.code === 'SKU_DIRECT_SUPPLIER_REQUIRED') {
        setErrors((prev) => ({
          ...prev,
          directSupplierId: '직배 SKU 는 직배 입점사가 필요합니다.',
        }));
        return;
      }
      const msg =
        e?.response?.data?.message ?? e?.message ?? '오류가 발생했습니다.';
      toast.error(msg);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  const groupOptions = [
    { value: '', label: '그룹 없음' },
    ...(groups ?? []).map((g) => ({ value: g.id, label: g.name })),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'SKU 편집' : 'SKU 생성'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <FormSection title="기본 정보">
            <FormField label="SKU명" required errorMessage={errors.name}>
              <FormInput
                value={form.name}
                onChange={(e) => set('name')(e.target.value)}
                placeholder="예: J-Curl Lash 0.15mm 10mm"
                error={!!errors.name}
              />
            </FormField>

            <FormField label="사업자용 상품명">
              <FormInput
                value={form.businessProductName}
                onChange={(e) => set('businessProductName')(e.target.value)}
                placeholder="선택 사항"
              />
            </FormField>
          </FormSection>

          <FormSection title="분류">
            <FormField label="SKU 그룹">
              <FormSelect
                value={form.groupId}
                onValueChange={set('groupId')}
                options={groupOptions}
                placeholder="그룹 선택"
              />
            </FormField>
          </FormSection>

          <FormSection title="재고 정책">
            <FormField label="재고 유형">
              <FormSelect
                value={form.stockType}
                onValueChange={set('stockType')}
                options={STOCK_TYPE_OPTIONS}
              />
            </FormField>

            <FormField
              label="배송 프로필"
              required={requiresDeliveryProfile(form.stockType)}
              errorMessage={errors.deliveryProfileId}
            >
              {profilesLoading ? (
                <p className="text-sm text-muted-foreground">불러오는 중…</p>
              ) : profilesError ? (
                <p className="text-sm text-destructive">
                  배송 프로필을 불러오지 못했습니다.
                </p>
              ) : profiles.length === 0 ? (
                <p className="text-sm text-destructive">
                  배송 프로필이 없습니다 —{' '}
                  <Link
                    href="/inventory/delivery-profiles"
                    className="underline"
                  >
                    먼저 등록하세요
                  </Link>
                  .
                </p>
              ) : (
                <FormSelect
                  value={form.deliveryProfileId || NO_DELIVERY_PROFILE}
                  onValueChange={(value) =>
                    set('deliveryProfileId')(
                      value === NO_DELIVERY_PROFILE ? '' : value
                    )
                  }
                  options={[
                    { value: NO_DELIVERY_PROFILE, label: '선택 안 함' },
                    ...profiles.map((p) => ({ value: p.id, label: p.name })),
                  ]}
                  placeholder="배송 프로필 선택"
                  error={!!errors.deliveryProfileId}
                />
              )}
            </FormField>

            {form.stockType === 'drop_shipped' && (
              <FormField
                label="직배 입점사"
                required
                errorMessage={errors.directSupplierId}
              >
                {directSuppliersLoading ? (
                  <p className="text-sm text-muted-foreground">불러오는 중…</p>
                ) : directSuppliersError ? (
                  <p className="text-sm text-destructive">
                    직배 입점사를 불러오지 못했습니다.
                  </p>
                ) : directList.length === 0 ? (
                  <p className="text-sm text-destructive">
                    직배 공급사가 없습니다 —{' '}
                    <Link href="/inventory/suppliers" className="underline">
                      공급사 화면에서 ‘직배’로 등록하세요
                    </Link>
                    .
                  </p>
                ) : (
                  <FormSelect
                    value={form.directSupplierId || NO_DIRECT_SUPPLIER}
                    onValueChange={(value) =>
                      set('directSupplierId')(
                        value === NO_DIRECT_SUPPLIER ? '' : value
                      )
                    }
                    options={[
                      { value: NO_DIRECT_SUPPLIER, label: '선택 안 함' },
                      ...directList.map((s) => ({
                        value: s.id,
                        label: s.name,
                      })),
                    ]}
                    placeholder="직배 입점사 선택"
                    error={!!errors.directSupplierId}
                  />
                )}
              </FormField>
            )}

            <p className="text-xs text-muted-foreground">
              안전재고는 수요 통계로 계산됩니다. 예외(제외 · 고정 안전재고 ·
              α)는{' '}
              <Link
                href="/inventory/replenishment/rules?tab=skus"
                className="underline"
              >
                보충 규칙 › SKU 예외
              </Link>
              에서 둡니다.
            </p>
          </FormSection>

          {isEdit && (
            <FormSection title="바코드">
              <BarcodeListSection
                skuId={sku.id}
                barcodes={freshSku?.barcodes ?? sku.barcodes}
              />
            </FormSection>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? '저장 중…' : isEdit ? '저장' : '생성'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
