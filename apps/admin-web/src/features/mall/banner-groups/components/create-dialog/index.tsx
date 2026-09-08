'use client';

import { useState } from 'react';
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


type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** code 는 NOT NULL UNIQUE 인데 시안에는 입력칸이 없다 — 상세에서도 읽기 전용이라 여기서 짓는다 */
const nextCode = () => `AY${Date.now().toString().slice(-6)}`;

export function BannerGroupCreateDialog({ open, onOpenChange }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const createMutation = useCreateBannerGroup();

  const handleClose = () => {
    setTitle('');
    setDescription('');
    setIsActive(true);
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast.error('배너 그룹명을 입력해 주세요.');
      return;
    }
    try {
      await createMutation.mutateAsync({
        code: nextCode(),
        title: title.trim(),
        description: description.trim() || undefined,
        isActive,
      });
      toast.success('배너 그룹이 생성되었습니다.');
      handleClose();
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
              hint="배너 그룹명을 입력하세요."
              required
              htmlFor="bg-title"
            >
              <Input
                id="bg-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="배너 그룹명"
                className="h-11 rounded-[6px] border-[#e4e4e7] shadow-none"
              />
            </Field>

            <Field
              label="배너 그룹 설명"
              hint="배너 그룹의 설명을 입력하세요."
              htmlFor="bg-description"
            >
              <Input
                id="bg-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="그룹 설명"
                className="h-11 rounded-[6px] border-[#e4e4e7] shadow-none"
              />
            </Field>
          </div>

          <div className="flex shrink-0 items-center gap-3 pt-7">
            <Button variant="outline" className="h-10 px-6" onClick={handleClose}>
              취소
            </Button>
            <Button
              className="h-10 px-6"
              onClick={handleSubmit}
              disabled={createMutation.isPending}
            >
              저장
            </Button>
            <ActiveSwitch
              checked={isActive}
              onCheckedChange={setIsActive}
              aria-label="생성 후 바로 노출"
            />
          </div>
        </div>

        <DialogFooter className="sm:justify-start">
          <p className="text-muted-foreground text-xs">
            배너 크기와 카테고리는 만든 뒤 상세 화면에서 정합니다.
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
  children,
}: {
  label: string;
  hint: string;
  required?: boolean;
  htmlFor: string;
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
      </div>
    </div>
  );
}
