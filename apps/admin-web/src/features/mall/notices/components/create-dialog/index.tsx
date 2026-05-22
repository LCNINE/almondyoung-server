'use client';

import { type ChangeEvent, useState } from 'react';
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
import { RichTextEditor, isEmptyHtml } from '@/components/common/rich-text-editor';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCreateNotice } from '@/lib/services/products';
import type { CreateNoticeDto } from '@/lib/types/dto/products';
import { toast } from 'sonner';
import { localInputToIso } from '@/lib/utils/datetime';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const EMPTY: CreateNoticeDto = {
  title: '',
  content: '',
  category: 'general',
  isPinned: false,
  isActive: true,
};

const NONE_VALUE = '__none__';
const switchClassName =
  'h-6 w-11 border border-border data-[state=unchecked]:bg-muted';

export function NoticeCreateDialog({ open, onOpenChange }: Props) {
  const [form, setForm] = useState<CreateNoticeDto>(EMPTY);
  const createMutation = useCreateNotice();
  const titleLength = form.title?.length ?? 0;
  const canSubmit =
    Boolean(form.title?.trim()) &&
    !isEmptyHtml(form.content ?? '') &&
    !createMutation.isPending;

  const set =
    <K extends keyof CreateNoticeDto>(key: K) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm(
        (prev) =>
          ({ ...prev, [key]: e.target.value || undefined }) as CreateNoticeDto
      );

  const handleClose = () => {
    setForm(EMPTY);
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!form.title?.trim()) {
      toast.error('제목을 입력해 주세요.');
      return;
    }
    if (isEmptyHtml(form.content ?? '')) {
      toast.error('본문을 입력해 주세요.');
      return;
    }
    try {
      await createMutation.mutateAsync({
        ...form,
        displayStartAt: localInputToIso(form.displayStartAt),
        displayEndAt: localInputToIso(form.displayEndAt),
      });
      toast.success('공지사항이 등록되었습니다.');
      handleClose();
    } catch {
      toast.error('등록에 실패했습니다.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[720px]">
        <DialogHeader className="shrink-0 border-b px-6 py-5">
          <DialogTitle>공지사항 등록</DialogTitle>
          <DialogDescription>
            고객에게 노출되는 쇼핑몰 공지를 작성합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto px-6 py-5">
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="title">
                제목 <span className="text-destructive">*</span>
              </Label>
              <span className="text-xs text-muted-foreground">
                {titleLength}자
              </span>
            </div>
            <Input
              id="title"
              className="h-11"
              placeholder="예: 설 연휴 배송 일정 안내"
              value={form.title ?? ''}
              onChange={set('title')}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="content">
              본문 <span className="text-destructive">*</span>
            </Label>
            <RichTextEditor
              value={form.content ?? ''}
              onChange={(html) =>
                setForm((prev) => ({ ...prev, content: html }))
              }
              imageContextId="notice-content-image"
              placeholder="공지 본문을 입력하세요."
            />
          </div>

          <div className="grid gap-4 rounded-md border bg-muted/20 p-4">
            <h3 className="text-sm font-medium">노출 설정</h3>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>분류</Label>
                <Select
                  value={form.category ?? 'general'}
                  onValueChange={(v) =>
                    setForm((prev) => ({ ...prev, category: v }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">일반</SelectItem>
                    <SelectItem value="event">이벤트</SelectItem>
                    <SelectItem value="delivery">배송</SelectItem>
                    <SelectItem value="service">서비스</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label>뱃지</Label>
                <Select
                  value={form.badge ?? NONE_VALUE}
                  onValueChange={(v) =>
                    setForm((prev) => ({
                      ...prev,
                      badge: v === NONE_VALUE ? undefined : v,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="없음" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>없음</SelectItem>
                    <SelectItem value="important">중요</SelectItem>
                    <SelectItem value="urgent">긴급</SelectItem>
                    <SelectItem value="new">신규</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-center justify-between gap-4 rounded-md border bg-background px-3 py-3">
                <Label htmlFor="isActive" className="cursor-pointer">
                  공개 게시
                </Label>
                <Switch
                  id="isActive"
                  className={switchClassName}
                  checked={form.isActive ?? true}
                  onCheckedChange={(checked) =>
                    setForm((prev) => ({ ...prev, isActive: checked }))
                  }
                />
              </div>
              <div className="flex items-center justify-between gap-4 rounded-md border bg-background px-3 py-3">
                <Label htmlFor="isPinned" className="cursor-pointer">
                  상단 고정
                </Label>
                <Switch
                  id="isPinned"
                  className={switchClassName}
                  checked={form.isPinned ?? false}
                  onCheckedChange={(checked) =>
                    setForm((prev) => ({ ...prev, isPinned: checked }))
                  }
                />
              </div>
            </div>
          </div>

          <div className="grid gap-4 rounded-md border bg-muted/20 p-4">
            <h3 className="text-sm font-medium">게시 기간</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="displayStartAt">게시 시작</Label>
                <Input
                  id="displayStartAt"
                  type="datetime-local"
                  value={form.displayStartAt ?? ''}
                  onChange={set('displayStartAt')}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="displayEndAt">게시 종료</Label>
                <Input
                  id="displayEndAt"
                  type="datetime-local"
                  value={form.displayEndAt ?? ''}
                  onChange={set('displayEndAt')}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              시작/종료를 비워두면 항상 게시됩니다.
            </p>
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t bg-background px-6 py-4">
          <Button variant="outline" onClick={handleClose}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            공지 등록
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
