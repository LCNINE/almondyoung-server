'use client';

import { useEffect, useState } from 'react';
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
import { useCreateSku, useUpdateSku, useSkuGroups } from '@/lib/services/inventory';
import { useSku } from '@/lib/services/inventory';
import type { SkuResponseDto, CreateSkuDto } from '@/lib/types/dto/inventory';
import { BarcodeListSection } from '../barcode-list-section';

const STOCK_TYPE_OPTIONS = [
  { value: 'physical', label: '사입' },
  { value: 'infinite', label: '무제한' },
  { value: 'drop_shipped', label: '직배' },
  { value: 'consignment', label: '위탁' },
];

type Props = {
  open: boolean;
  sku: SkuResponseDto | null;
  onOpenChange: (open: boolean) => void;
};

type FormState = {
  name: string;
  businessProductName: string;
  stockType: string;
  safetyStock: string;
  groupId: string;
};

const DEFAULT_FORM: FormState = {
  name: '',
  businessProductName: '',
  stockType: 'physical',
  safetyStock: '0',
  groupId: '',
};

function formFromSku(sku: SkuResponseDto): FormState {
  return {
    name: sku.name,
    businessProductName: sku.businessProductName ?? '',
    stockType: sku.stockType,
    safetyStock: String(sku.safetyStock),
    groupId: sku.groupId ?? '',
  };
}

export function SkuFormDialog({ open, sku, onOpenChange }: Props) {
  const isEdit = !!sku;
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});

  const createMutation = useCreateSku();
  const updateMutation = useUpdateSku();
  const { data: groups } = useSkuGroups();

  // 편집 시 최신 SKU 데이터(바코드 포함) 가져오기
  const { data: freshSku } = useSku(sku?.id ?? '');

  useEffect(() => {
    if (open) {
      setForm(sku ? formFromSku(sku) : DEFAULT_FORM);
      setErrors({});
    }
  }, [open, sku]);

  const set = (field: keyof FormState) => (value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const validate = (): boolean => {
    const next: typeof errors = {};
    if (!form.name.trim()) next.name = '이름은 필수입니다.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    const payload: CreateSkuDto = {
      name: form.name.trim(),
      businessProductName: form.businessProductName || undefined,
      stockType: form.stockType as CreateSkuDto['stockType'],
      safetyStock: Number(form.safetyStock) || 0,
      skuGroupId: form.groupId || undefined,
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
      const msg = e?.response?.data?.message ?? e?.message ?? '오류가 발생했습니다.';
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

            <FormField label="안전 재고">
              <FormInput
                type="number"
                min={0}
                value={form.safetyStock}
                onChange={(e) => set('safetyStock')(e.target.value)}
                placeholder="0"
              />
            </FormField>
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
