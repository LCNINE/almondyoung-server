'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
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

export function NoticeCreateDialog({ open, onOpenChange }: Props) {
  const [form, setForm] = useState<CreateNoticeDto>(EMPTY);
  const createMutation = useCreateNotice();

  const set =
    <K extends keyof CreateNoticeDto>(key: K) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value || undefined }) as CreateNoticeDto);

  const handleClose = () => {
    setForm(EMPTY);
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!form.title?.trim()) {
      toast.error('제목을 입력해 주세요.');
      return;
    }
    if (!form.content?.trim()) {
      toast.error('본문을 입력해 주세요.');
      return;
    }
    try {
      await createMutation.mutateAsync(form);
      toast.success('공지사항이 등록되었습니다.');
      handleClose();
    } catch {
      toast.error('등록에 실패했습니다.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>공지사항 등록</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="title">
              제목 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="title"
              placeholder="예: [공지] 2024년 설 연휴 배송 안내"
              value={form.title}
              onChange={set('title')}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="content">
              본문 <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="content"
              rows={8}
              placeholder="공지 본문 (HTML/마크다운 가능)"
              value={form.content}
              onChange={set('content')}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label>분류</Label>
              <Select
                value={form.category ?? 'general'}
                onValueChange={(v) => setForm((prev) => ({ ...prev, category: v }))}
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

            <div className="grid gap-1.5">
              <Label>뱃지</Label>
              <Select
                value={form.badge ?? NONE_VALUE}
                onValueChange={(v) =>
                  setForm((prev) => ({ ...prev, badge: v === NONE_VALUE ? undefined : v }))
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

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="displayStartAt">게시 시작</Label>
              <Input
                id="displayStartAt"
                type="datetime-local"
                value={form.displayStartAt ?? ''}
                onChange={set('displayStartAt')}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="displayEndAt">게시 종료</Label>
              <Input
                id="displayEndAt"
                type="datetime-local"
                value={form.displayEndAt ?? ''}
                onChange={set('displayEndAt')}
              />
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <Switch
                id="isPinned"
                checked={form.isPinned ?? false}
                onCheckedChange={(checked) =>
                  setForm((prev) => ({ ...prev, isPinned: checked }))
                }
              />
              <Label htmlFor="isPinned">상단 고정</Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="isActive"
                checked={form.isActive ?? true}
                onCheckedChange={(checked) =>
                  setForm((prev) => ({ ...prev, isActive: checked }))
                }
              />
              <Label htmlFor="isActive">활성</Label>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={createMutation.isPending}>
            등록
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
