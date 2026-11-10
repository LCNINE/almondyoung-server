'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Can } from '@/components/auth/can';
import { PermissionReadOnly } from '@/components/auth/permission-read-only';
import { useCreateTopNotice, useUpdateTopNotice } from '@/lib/services/products';
import { TOP_NOTICE_TEXT_MAX_LENGTH, type TopNoticeDto } from '@/lib/types/dto/products';
import {
  EMPTY_TOP_NOTICE_FORM,
  topNoticeFormFromDto,
  topNoticeFormToCreateDto,
  topNoticeFormToUpdateDto,
  validateTopNoticeForm,
  type TopNoticeFormValue,
} from '../../form';

type Props = {
  open: boolean;
  /** 없으면 등록, 있으면 수정 */
  target: TopNoticeDto | null;
  onOpenChange: (open: boolean) => void;
};

const switchClassName = 'h-6 w-11 border border-border data-[state=unchecked]:bg-muted';

export function TopNoticeFormDialog({ open, target, onOpenChange }: Props) {
  const [form, setForm] = useState<TopNoticeFormValue>(EMPTY_TOP_NOTICE_FORM);
  const createMutation = useCreateTopNotice();
  const updateMutation = useUpdateTopNotice();
  const isEdit = target !== null;
  const isPending = createMutation.isPending || updateMutation.isPending;

  useEffect(() => {
    if (open) setForm(target ? topNoticeFormFromDto(target) : EMPTY_TOP_NOTICE_FORM);
  }, [open, target]);

  const set = <K extends keyof TopNoticeFormValue>(key: K, next: TopNoticeFormValue[K]) =>
    setForm((prev) => ({ ...prev, [key]: next }));

  const handleSubmit = async () => {
    const error = validateTopNoticeForm(form);

    if (error) {
      toast.error(error);
      return;
    }

    try {
      if (target) {
        await updateMutation.mutateAsync({ id: target.id, dto: topNoticeFormToUpdateDto(form) });
        toast.success('상단 공지 띠가 수정되었습니다.');
      } else {
        await createMutation.mutateAsync(topNoticeFormToCreateDto(form));
        toast.success('상단 공지 띠가 등록되었습니다.');
      }

      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '저장에 실패했습니다.');
    }
  };

  const fields = (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="top-notice-text">
          문구 <span className="text-destructive">*</span>
        </Label>
        <Input
          id="top-notice-text"
          maxLength={TOP_NOTICE_TEXT_MAX_LENGTH}
          placeholder="5만원 이상 구매 시 무료배송"
          value={form.text}
          onChange={(e) => set('text', e.target.value)}
        />
        <p className="text-muted-foreground text-right text-xs">
          {form.text.trim().length} / {TOP_NOTICE_TEXT_MAX_LENGTH}
        </p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="top-notice-link">클릭 시 이동할 링크</Label>
        <Input
          id="top-notice-link"
          placeholder="/cs/notice/공지ID, /products/... 또는 https://..."
          value={form.linkUrl}
          onChange={(e) => set('linkUrl', e.target.value)}
        />
        <p className="text-muted-foreground text-xs">비워두면 눌러도 이동하지 않습니다.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="top-notice-start">게시 시작</Label>
          <Input
            id="top-notice-start"
            type="datetime-local"
            value={form.displayStartAt}
            onChange={(e) => set('displayStartAt', e.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="top-notice-end">게시 종료</Label>
          <Input
            id="top-notice-end"
            type="datetime-local"
            value={form.displayEndAt}
            onChange={(e) => set('displayEndAt', e.target.value)}
          />
        </div>
      </div>
      <p className="text-muted-foreground -mt-2 text-xs">기간을 비워두면 계속 노출됩니다.</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="bg-background flex items-center justify-between gap-4 rounded-md border px-3 py-3">
          <Label htmlFor="top-notice-active" className="cursor-pointer">
            노출 사용
          </Label>
          <Switch
            id="top-notice-active"
            className={switchClassName}
            checked={form.isActive}
            onCheckedChange={(checked) => set('isActive', checked)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="top-notice-sort">노출 순서 (낮을수록 먼저)</Label>
          <Input
            id="top-notice-sort"
            type="number"
            value={form.sortOrder}
            onChange={(e) => set('sortOrder', e.target.value)}
          />
        </div>
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? '상단 공지 띠 수정' : '상단 공지 띠 등록'}</DialogTitle>
          <DialogDescription>
            모든 방문자에게 같은 띠가 보입니다. 여러 개면 노출 순서대로 돌아가며 보입니다.
          </DialogDescription>
        </DialogHeader>

        {isEdit ? <PermissionReadOnly run={useUpdateTopNotice}>{fields}</PermissionReadOnly> : fields}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            취소
          </Button>
          <Can run={isEdit ? useUpdateTopNotice : useCreateTopNotice}>
            <Button onClick={handleSubmit} disabled={isPending}>
              {isEdit ? '저장' : '등록'}
            </Button>
          </Can>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
