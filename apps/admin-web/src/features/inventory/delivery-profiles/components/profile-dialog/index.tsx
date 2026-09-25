'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FormField } from '@/components/common/form/form-field';
import { FormInput } from '@/components/common/form/form-input';
import { FormSelect } from '@/components/common/form/form-select';
import { FormSection } from '@/components/common/form/form-section';
import { useCreateDeliveryProfile, useUpdateDeliveryProfile } from '@/lib/services/inventory';
import type { DeliveryProfileDto, FulfillmentMode } from '@/lib/types/dto/inventory';
import {
  emptyProfileForm,
  formFromProfile,
  toCreatePayload,
  toUpdatePayload,
  validateProfileForm,
  type ProfileFormErrors,
  type ProfileFormState,
} from '../../lib/profile-form';
import { FULFILLMENT_MODE_LABELS, SOURCE_TYPE_LABELS } from '../../lib/labels';

type Props = { open: boolean; profile: DeliveryProfileDto | null; onOpenChange: (open: boolean) => void };

const SOURCE_OPTIONS = Object.entries(SOURCE_TYPE_LABELS).map(([value, label]) => ({ value, label }));
const MODES = Object.keys(FULFILLMENT_MODE_LABELS) as FulfillmentMode[]; // Object.keys returns string[]; TypeScript cannot infer enum values at runtime

export function ProfileDialog({ open, profile, onOpenChange }: Props) {
  const isEdit = !!profile;
  const [form, setForm] = useState<ProfileFormState>(emptyProfileForm());
  const [errors, setErrors] = useState<ProfileFormErrors>({});
  const create = useCreateDeliveryProfile();
  const update = useUpdateDeliveryProfile();

  useEffect(() => {
    if (open) {
      setForm(profile ? formFromProfile(profile) : emptyProfileForm());
      setErrors({});
    }
  }, [open, profile]);

  const set =
    <K extends keyof ProfileFormState>(key: K) =>
    (value: ProfileFormState[K]) =>
      setForm((prev) => ({ ...prev, [key]: value }));

  const toggleMode = (mode: FulfillmentMode, checked: boolean) =>
    setForm((prev) => ({
      ...prev,
      modes: checked ? [...prev.modes.filter((m) => m !== mode), mode] : prev.modes.filter((m) => m !== mode),
    }));

  const input = (key: keyof ProfileFormState, label: string, required = true, placeholder?: string) => (
    <FormField label={label} required={required} errorMessage={errors[key]}>
      <FormInput
        value={String(form[key])}
        onChange={(e) => set(key)(e.target.value as never)} // Generic helper only renders string fields; TypeScript can't narrow ProfileFormState[K] through a generic key
        placeholder={placeholder}
        error={!!errors[key]}
      />
    </FormField>
  );

  const handleSubmit = async () => {
    const next = validateProfileForm(form);
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    try {
      if (profile) {
        const data = toUpdatePayload(profile, form);
        if (Object.keys(data).length > 0) await update.mutateAsync({ id: profile.id, data });
        toast.success('배송 프로필이 수정되었습니다.');
      } else {
        await create.mutateAsync(toCreatePayload(form));
        toast.success('배송 프로필이 생성되었습니다.');
      }
      onOpenChange(false);
    } catch (e: unknown) {
      const message =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '저장하지 못했습니다.'; // API error shape from mutation libraries like TanStack Query
      toast.error(message);
    }
  };

  const pending = create.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? '배송 프로필 수정' : '배송 프로필 생성'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <FormSection title="기본">
            {input('name', '이름', true, '예: 부천 자사 출고')}
            <FormField label="원천" required>
              <FormSelect value={form.sourceType} onValueChange={(v) => set('sourceType')(v as ProfileFormState['sourceType'])} options={SOURCE_OPTIONS} /> {/* FormSelect returns string; cast matches select option values */}
            </FormField>
            {input('avgDeliveryDays', '평균 배송일', false, '선택')}
            {input('carrierAccountRef', '택배 계약번호')}
            <FormField label="이행 방식" required errorMessage={errors.modes}>
              <div className="flex gap-4">
                {MODES.map((mode) => (
                  <label key={mode} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={form.modes.includes(mode)} onCheckedChange={(c) => toggleMode(mode, c === true)} />
                    {FULFILLMENT_MODE_LABELS[mode]}
                  </label>
                ))}
              </div>
            </FormField>
          </FormSection>
          <FormSection title="발송인 (3PL 이면 그 센터 정보)">
            {input('senderName', '이름')}
            {input('senderPhone', '전화번호')}
          </FormSection>
          <FormSection title="출고지">
            {input('originPostalCode', '우편번호')}
            {input('originRoadAddress', '도로명 주소')}
            {input('originDetailAddress', '상세 주소', false)}
          </FormSection>
          <FormSection title="반품지">
            {input('returnPostalCode', '우편번호')}
            {input('returnRoadAddress', '도로명 주소')}
            {input('returnDetailAddress', '상세 주소', false)}
            {input('returnPhone', '연락처', false)}
          </FormSection>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={pending}>
            {pending ? '저장 중…' : isEdit ? '저장' : '생성'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
