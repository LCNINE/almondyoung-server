'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  useReplenishmentSettings,
  useUpdateReplenishmentSettings,
} from '@/lib/services/inventory';
import {
  SETTINGS_SECTIONS,
  settingsFormFrom,
  settingsPayloadFrom,
  type SettingsField,
  type SettingsFieldSpec,
  type SettingsForm,
} from '../../../rules-model';
import { runWithToast } from '../../save-with-toast';

/** 모듈 스코프 — 렌더 안에서 선언하면 한 글자 칠 때마다 입력이 재마운트된다. */
function SettingsInput({
  spec,
  value,
  error,
  onChange,
}: {
  spec: SettingsFieldSpec;
  value: string;
  error: string | undefined;
  onChange: (next: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span>{spec.label}</span>
      <Input
        value={value}
        placeholder={spec.nullable === true ? '(비움)' : undefined}
        aria-invalid={error !== undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {error !== undefined && (
        <span className="text-xs text-destructive">{error}</span>
      )}
    </label>
  );
}

export function SettingsTab() {
  const { data, isLoading } = useReplenishmentSettings();
  const update = useUpdateReplenishmentSettings();
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [errors, setErrors] = useState<Partial<Record<SettingsField, string>>>(
    {}
  );

  useEffect(() => {
    if (data) setForm(settingsFormFrom(data));
  }, [data]);

  if (isLoading || !data || form === null)
    return <p className="p-4 text-sm text-muted-foreground">로딩 중...</p>;

  const handleSave = async () => {
    const { payload, errors: next } = settingsPayloadFrom(form, data);
    setErrors(next);
    if (Object.keys(next).length > 0) {
      toast.error('입력을 확인하세요.');
      return;
    }
    if (Object.keys(payload).length === 0) {
      toast.info('바뀐 값이 없습니다.');
      return;
    }
    await runWithToast({
      run: () => update.mutateAsync(payload),
      success: '전역 설정을 저장했습니다.',
      failure: '저장에 실패했습니다.',
      onSuccess: () => setErrors({}),
    });
  };

  return (
    <div className="flex flex-col gap-6 p-4">
      {/* 반영 시점 문구는 절마다 한 번. 필드마다 배지를 붙이면 라벨보다 길어져 안 읽힌다. */}
      {SETTINGS_SECTIONS.map((section) => (
        <section key={section.reflection} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{section.title}</h3>
            <Badge
              variant={
                section.reflection === 'immediate' ? 'secondary' : 'outline'
              }
            >
              {section.note}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">{section.description}</p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {section.fields.map((spec) => (
              <SettingsInput
                key={spec.key}
                spec={spec}
                value={form[spec.key]}
                error={errors[spec.key]}
                onChange={(next) => setForm({ ...form, [spec.key]: next })}
              />
            ))}
          </div>
        </section>
      ))}
      <div className="flex justify-end">
        <Button onClick={() => void handleSave()} disabled={update.isPending}>
          {update.isPending ? '저장 중...' : '저장'}
        </Button>
      </div>
    </div>
  );
}
