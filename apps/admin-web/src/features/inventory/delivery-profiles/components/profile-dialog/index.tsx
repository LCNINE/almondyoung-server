'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { AddressSearchDialog } from '@/components/common/address-search-dialog';
import { FormField } from '@/components/common/form/form-field';
import { FormInput } from '@/components/common/form/form-input';
import { FormSelect } from '@/components/common/form/form-select';
import { FormSection } from '@/components/common/form/form-section';
import {
  useCreateDeliveryProfile,
  useCreateHolder,
  useHolders,
  useUpdateDeliveryProfile,
} from '@/lib/services/inventory';
import type {
  DeliveryProfileDto,
  FulfillmentMode,
} from '@/lib/types/dto/inventory';
import {
  copiedProfileForm,
  emptyProfileForm,
  formFromProfile,
  toCreatePayload,
  toUpdatePayload,
  validateProfileForm,
  type ProfileFormErrors,
  type ProfileFormState,
} from '../../lib/profile-form';
import { FULFILLMENT_MODE_LABELS, SOURCE_TYPE_LABELS } from '../../lib/labels';

export type ProfileEditTarget =
  | { mode: 'new' }
  | { mode: 'edit' | 'copy'; profile: DeliveryProfileDto };

type Props = {
  target: ProfileEditTarget | null;
  onOpenChange: (open: boolean) => void;
};

const NEW_HOLDER = '__new';
const NO_HOLDER = '__none';
const SOURCE_OPTIONS = Object.entries(SOURCE_TYPE_LABELS).map(
  ([value, label]) => ({ value, label })
);
const MODES = Object.keys(FULFILLMENT_MODE_LABELS) as FulfillmentMode[]; // Object.keys returns string[]; TypeScript cannot infer enum values at runtime
const TITLES = {
  new: '배송 프로필 추가',
  edit: '배송 프로필 수정',
  copy: '배송 프로필 복제',
} as const;

function initialForm(target: ProfileEditTarget): ProfileFormState {
  if (target.mode === 'new') return emptyProfileForm();
  if (target.mode === 'copy') return copiedProfileForm(target.profile);

  return formFromProfile(target.profile);
}

export function ProfileDialog({ target, onOpenChange }: Props) {
  const [form, setForm] = useState<ProfileFormState>(emptyProfileForm());
  const [errors, setErrors] = useState<ProfileFormErrors>({});
  const [holderChoice, setHolderChoice] = useState(NO_HOLDER);
  const [newHolderName, setNewHolderName] = useState('');
  const [searching, setSearching] = useState<'origin' | 'return' | null>(null);
  const create = useCreateDeliveryProfile();
  const update = useUpdateDeliveryProfile();
  const createHolder = useCreateHolder();
  const { data: holdersResponse } = useHolders({ limit: 100 });

  useEffect(() => {
    if (!target) return;

    const next = initialForm(target);
    setForm(next);
    setHolderChoice(next.holderId || NO_HOLDER);
    setNewHolderName('');
    setErrors({});
  }, [target]);

  const set =
    <K extends keyof ProfileFormState>(key: K) =>
    (value: ProfileFormState[K]) =>
      setForm((prev) => ({ ...prev, [key]: value }));

  const toggleMode = (mode: FulfillmentMode, checked: boolean) =>
    setForm((prev) => ({
      ...prev,
      modes: checked
        ? [...prev.modes.filter((m) => m !== mode), mode]
        : prev.modes.filter((m) => m !== mode),
    }));

  const input = (
    key: keyof ProfileFormState,
    label: string,
    required = true,
    placeholder?: string,
    readOnly = false
  ) => (
    <FormField label={label} required={required} errorMessage={errors[key]}>
      <FormInput
        value={String(form[key])}
        onChange={(e) => set(key)(e.target.value as never)} // Generic helper only renders string fields; TypeScript can't narrow ProfileFormState[K] through a generic key
        placeholder={placeholder}
        readOnly={readOnly}
        error={!!errors[key]}
      />
    </FormField>
  );

  const addressFields = (prefix: 'origin' | 'return') => (
    <>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          {input(
            `${prefix}PostalCode`,
            '우편번호',
            true,
            '주소 검색으로 채워져요',
            true
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => setSearching(prefix)}
        >
          주소 검색
        </Button>
      </div>
      {input(`${prefix}RoadAddress`, '도로명 주소', true, undefined, true)}
      {input(`${prefix}DetailAddress`, '상세 주소', false)}
    </>
  );

  const holderOptions = [
    { value: NO_HOLDER, label: '연결 안 함(자사)' },
    ...(holdersResponse?.data ?? []).map((h) => ({
      value: h.id,
      label: h.isOurAsset ? `${h.name} (자사)` : h.name,
    })),
    { value: NEW_HOLDER, label: '+ 새 화주 만들기' },
  ];

  const resolveHolderId = async (): Promise<string> => {
    if (holderChoice === NO_HOLDER) return '';
    if (holderChoice !== NEW_HOLDER) return holderChoice;

    const holder = await createHolder.mutateAsync({
      name: newHolderName.trim(),
      isOurAsset: false,
    });

    return holder.id;
  };

  const handleSubmit = async () => {
    const next = validateProfileForm(form);
    if (holderChoice === NEW_HOLDER && !newHolderName.trim())
      next.holderId = '새 화주 이름을 입력하세요.';
    setErrors(next);
    if (Object.keys(next).length > 0 || !target) return;

    try {
      const holderId = await resolveHolderId();
      const filled = { ...form, holderId };
      if (target.mode === 'edit') {
        const data = toUpdatePayload(target.profile, filled);
        if (Object.keys(data).length > 0)
          await update.mutateAsync({ id: target.profile.id, data });
        toast.success('배송 프로필을 수정했어요.');
      } else {
        await create.mutateAsync(toCreatePayload(filled));
        toast.success('배송 프로필을 만들었어요.');
      }

      onOpenChange(false);
    } catch (e: unknown) {
      const message =
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? '저장하지 못했어요.'; // API error shape from mutation libraries like TanStack Query
      toast.error(message);
    }
  };

  const pending =
    create.isPending || update.isPending || createHolder.isPending;

  return (
    <Sheet open={target !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-[520px]">
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle>{target ? TITLES[target.mode] : ''}</SheetTitle>
        </SheetHeader>
        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <FormSection title="기본">
            {input('name', '이름', true, '예: 업체명 위탁 출고')}
            <FormField label="업체(화주)" errorMessage={errors.holderId}>
              <FormSelect
                value={holderChoice}
                onValueChange={setHolderChoice}
                options={holderOptions}
              />
            </FormField>
            {holderChoice === NEW_HOLDER && (
              <div className="bg-muted/50 space-y-2 rounded-md border p-3">
                <FormField label="새 화주 이름" required>
                  <FormInput
                    value={newHolderName}
                    onChange={(e) => setNewHolderName(e.target.value)}
                    placeholder="예: 업체명"
                  />
                </FormField>
                <p className="text-muted-foreground text-xs">
                  우리 재고가 아닌 화주로 만들어져요. 이름 고치기·삭제는 화주
                  관리에서 해요.
                </p>
              </div>
            )}
            <FormField label="출고 방식" required errorMessage={errors.modes}>
              <div className="flex gap-4">
                {MODES.map((mode) => (
                  <label key={mode} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={form.modes.includes(mode)}
                      onCheckedChange={(c) => toggleMode(mode, c === true)}
                    />
                    {FULFILLMENT_MODE_LABELS[mode]}
                  </label>
                ))}
              </div>
            </FormField>
            <FormField label="원천" required>
              <FormSelect
                value={form.sourceType}
                onValueChange={(v) =>
                  set('sourceType')(v as ProfileFormState['sourceType'])
                } // FormSelect returns string; cast matches select option values
                options={SOURCE_OPTIONS}
              />
            </FormField>
            {input('avgDeliveryDays', '평균 배송일', false, '선택')}
          </FormSection>

          <FormSection title="보내는 분">
            <div className="grid grid-cols-2 gap-2">
              {input('senderName', '이름')}
              {input('senderPhone', '전화번호')}
            </div>
            <p className="bg-muted text-muted-foreground rounded-md px-3 py-2 text-sm">
              송장 보낸분 칸에{' '}
              <b className="text-foreground">
                {form.senderName.trim() || '(보내는 분 이름)'}
              </b>
              (으)로 찍혀요.
            </p>
          </FormSection>

          <FormSection title="출고지">{addressFields('origin')}</FormSection>

          <FormSection title="반품지">
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <Checkbox
                checked={form.returnSameAsOrigin}
                onCheckedChange={(c) => set('returnSameAsOrigin')(c === true)}
              />
              출고지와 같아요
            </label>
            {!form.returnSameAsOrigin && (
              <>
                {addressFields('return')}
                {input(
                  'returnPhone',
                  '반품 받는 분 연락처',
                  false,
                  '비우면 보내는 분 번호를 써요'
                )}
              </>
            )}
          </FormSection>

          <FormSection title="택배 계약">
            {input('carrierAccountRef', '택배 계약번호')}
          </FormSection>
        </div>
        <SheetFooter className="flex-row gap-2 border-t px-6 py-4">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => onOpenChange(false)}
          >
            취소
          </Button>
          <Button
            className="flex-[2]"
            onClick={handleSubmit}
            disabled={pending}
          >
            {pending ? '저장 중…' : '저장'}
          </Button>
        </SheetFooter>
      </SheetContent>

      <AddressSearchDialog
        open={searching !== null}
        onOpenChange={(open) => !open && setSearching(null)}
        onSelect={({ zipcode, address }) => {
          if (!searching) return;

          setForm((prev) => ({
            ...prev,
            [`${searching}PostalCode`]: zipcode,
            [`${searching}RoadAddress`]: address,
          }));
        }}
      />
    </Sheet>
  );
}
