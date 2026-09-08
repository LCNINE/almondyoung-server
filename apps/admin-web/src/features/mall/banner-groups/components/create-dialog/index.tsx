'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCreateBannerGroup } from '@/lib/services/products';
import { toast } from 'sonner';
import { ActiveSwitch } from '@/components/common/active-switch';
import { BANNER_GROUP_PRESETS } from '../../banner-group-presets';
import { cn } from '@/lib/utils/cn';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * code 는 NOT NULL UNIQUE 인데 시안에는 입력칸이 없다 — 상세에서도 읽기 전용이라 여기서 짓는다.
 * 타임스탬프 6자리만 쓰면 약 16분마다 같은 값이 돌아와 409 가 난다. 난수를 섞는다.
 */
const nextCode = () =>
  `AY${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();

export function BannerGroupCreateDialog({ open, onOpenChange }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [titleError, setTitleError] = useState('');
  const [preset, setPreset] = useState(BANNER_GROUP_PRESETS[0]);
  const createMutation = useCreateBannerGroup();
  const router = useRouter();

  const handleClose = () => {
    setTitle('');
    setDescription('');
    setIsActive(false);
    setTitleError('');
    setPreset(BANNER_GROUP_PRESETS[0]);
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      setTitleError('배너 그룹명을 입력해 주세요.');
      return;
    }
    setTitleError('');
    try {
      const created = await createMutation.mutateAsync({
        code: nextCode(),
        title: title.trim(),
        description: description.trim() || undefined,
        pcWidth: preset.pcWidth,
        pcHeight: preset.pcHeight,
        mobileWidth: preset.mobileWidth,
        mobileHeight: preset.mobileHeight,
        isActive,
      });
      toast.success('배너 그룹이 생성되었습니다.');
      handleClose();
      router.push(`/mall/banner-groups/${created.id}`);
    } catch {
      toast.error('생성에 실패했습니다.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>배너 그룹 생성</DialogTitle>
        </DialogHeader>

        <div className="flex items-start gap-8 py-2">
          <div className="grid flex-1 gap-6">
            <Field
              label="배너 그룹명"
              hint=""
              required
              htmlFor="bg-title"
              error={titleError}
            >
              <Input
                id="bg-title"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (titleError) setTitleError('');
                }}
                placeholder="배너 그룹명"
                aria-invalid={!!titleError}
                className={cn(
                  'h-11 rounded-[6px] border-[#e4e4e7] shadow-none',
                  titleError && 'border-destructive'
                )}
              />
            </Field>

            <Field label="배너 그룹 설명" hint="" htmlFor="bg-description">
              <Input
                id="bg-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="그룹 설명"
                className="h-11 rounded-[6px] border-[#e4e4e7] shadow-none"
              />
            </Field>

            <Field label="배너 규격" hint="" htmlFor="bg-preset">
              <div className="flex flex-wrap gap-2">
                {BANNER_GROUP_PRESETS.map((p) => (
                  <Button
                    key={p.label}
                    type="button"
                    variant={preset.label === p.label ? 'default' : 'outline'}
                    size="sm"
                    title={p.hint}
                    onClick={() => setPreset(p)}
                  >
                    {p.label} ({p.pcWidth}×{p.pcHeight})
                  </Button>
                ))}
              </div>
            </Field>

            <Field label="노출 상태" hint="" htmlFor="bg-isActive">
              <div className="flex items-center gap-2">
                <ActiveSwitch
                  id="bg-isActive"
                  checked={isActive}
                  onCheckedChange={setIsActive}
                />
                <span className="text-[13px] text-[#52525b]">
                  {isActive
                    ? '만들자마자 고객 화면에 나옵니다'
                    : '숨김 — 배너를 채운 뒤 켜세요'}
                </span>
              </div>
            </Field>
          </div>

          <div className="flex shrink-0 items-center gap-3 pt-7">
            <Button
              variant="outline"
              className="h-10 px-6"
              onClick={handleClose}
            >
              취소
            </Button>
            <Button
              className="h-10 px-6"
              onClick={handleSubmit}
              disabled={createMutation.isPending}
            >
              저장
            </Button>
          </div>
        </div>

        <DialogFooter className="sm:justify-start">
          <p className="text-muted-foreground text-xs">
            카테고리와 세부 크기는 만든 뒤 상세 화면에서 바꿀 수 있습니다.
          </p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  hint,
  required,
  htmlFor,
  error,
  children,
}: {
  label: string;
  hint: string;
  required?: boolean;
  htmlFor: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-center gap-4">
      <label
        htmlFor={htmlFor}
        className="text-[15px] font-bold whitespace-nowrap text-[#1f2937]"
      >
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      <div>
        <p className="text-muted-foreground mb-1.5 text-[13px]">{hint}</p>
        {children}
        {error && <p className="text-destructive mt-1.5 text-xs">{error}</p>}
      </div>
    </div>
  );
}
