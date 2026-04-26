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
import { FormSection } from '@/components/common/form/form-section';
import { useCreateSkuGroup, useUpdateSkuGroup } from '@/lib/services/inventory';
import type { SkuGroupResponseDto } from '@/lib/types/dto/inventory';

type Props = {
  open: boolean;
  group: SkuGroupResponseDto | null;
  onOpenChange: (open: boolean) => void;
};

type FormState = {
  name: string;
  code: string;
  description: string;
};

const DEFAULT_FORM: FormState = { name: '', code: '', description: '' };

export function GroupFormDialog({ open, group, onOpenChange }: Props) {
  const isEdit = !!group;
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});

  const createMutation = useCreateSkuGroup();
  const updateMutation = useUpdateSkuGroup();

  useEffect(() => {
    if (open) {
      setForm(
        group
          ? { name: group.name, code: group.code, description: group.description ?? '' }
          : DEFAULT_FORM
      );
      setErrors({});
    }
  }, [open, group]);

  const set = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const validate = (): boolean => {
    const next: typeof errors = {};
    if (!form.name.trim()) next.name = '그룹명은 필수입니다.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    try {
      if (isEdit) {
        await updateMutation.mutateAsync({
          id: group.id,
          data: {
            name: form.name.trim(),
            description: form.description.trim() || undefined,
          },
        });
        toast.success('그룹이 수정되었습니다.');
      } else {
        await createMutation.mutateAsync({
          name: form.name.trim(),
          code: form.code.trim() || undefined,
          description: form.description.trim() || undefined,
        });
        toast.success('그룹이 생성되었습니다.');
      }
      onOpenChange(false);
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? e?.message ?? '오류가 발생했습니다.';
      toast.error(msg);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{isEdit ? '그룹 편집' : '그룹 생성'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <FormSection title="기본 정보">
            <FormField label="그룹명" required errorMessage={errors.name}>
              <FormInput
                value={form.name}
                onChange={set('name')}
                placeholder="예: J-Curl Collection"
                error={!!errors.name}
              />
            </FormField>

            {!isEdit && (
              <FormField label="그룹 코드" helperText="비워두면 자동 생성됩니다.">
                <FormInput
                  value={form.code}
                  onChange={set('code')}
                  placeholder="예: GROUP-J-CURL"
                  className="font-mono"
                />
              </FormField>
            )}

            <FormField label="설명">
              <FormInput
                value={form.description}
                onChange={set('description')}
                placeholder="선택 사항"
              />
            </FormField>
          </FormSection>
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
