'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  RichTextEditor,
  isEmptyHtml,
} from '@/features/mall/notices/components/rich-text-editor';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useUpdateNotice } from '@/lib/services/products';
import type { NoticeDto, UpdateNoticeDto } from '@/lib/types/dto/products';
import { toast } from 'sonner';
import { localInputToIso } from '@/lib/utils/datetime';

type Props = {
  notice: NoticeDto;
  onCancel?: () => void;
  onSaved?: () => void;
};

const NONE_VALUE = '__none__';

const toLocalInput = (iso: string | null): string => {
  if (!iso) return '';
  const date = new Date(iso);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
};

export function NoticeForm({ notice, onCancel, onSaved }: Props) {
  const [form, setForm] = useState<UpdateNoticeDto>({});
  const updateMutation = useUpdateNotice();

  useEffect(() => {
    setForm({
      title: notice.title,
      content: notice.content,
      category: notice.category,
      badge: notice.badge,
      isPinned: notice.isPinned,
      displayStartAt: toLocalInput(notice.displayStartAt),
      displayEndAt: toLocalInput(notice.displayEndAt),
      isActive: notice.isActive,
      sortOrder: notice.sortOrder,
    });
  }, [notice]);

  const set =
    <K extends keyof UpdateNoticeDto>(key: K) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value || undefined }) as UpdateNoticeDto);

  const setNum =
    <K extends keyof UpdateNoticeDto>(key: K) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({
        ...prev,
        [key]: e.target.value ? Number(e.target.value) : undefined,
      }) as UpdateNoticeDto);

  const handleSave = async () => {
    if (!form.title?.trim()) {
      toast.error('제목을 입력해 주세요.');
      return;
    }
    if (isEmptyHtml(form.content ?? '')) {
      toast.error('본문을 입력해 주세요.');
      return;
    }
    try {
      await updateMutation.mutateAsync({
        id: notice.id,
        dto: {
          ...form,
          displayStartAt: localInputToIso(form.displayStartAt),
          displayEndAt: localInputToIso(form.displayEndAt),
        },
      });
      toast.success('공지사항이 수정되었습니다.');
      onSaved?.();
    } catch {
      toast.error('수정에 실패했습니다.');
    }
  };

  return (
    <div className="p-6">
      <div className="grid max-w-3xl gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="title">
            제목 <span className="text-destructive">*</span>
          </Label>
          <Input id="title" value={form.title ?? ''} onChange={set('title')} />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="content">
            본문 <span className="text-destructive">*</span>
          </Label>
          <RichTextEditor
            value={form.content ?? ''}
            onChange={(html) => setForm((prev) => ({ ...prev, content: html }))}
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
                setForm((prev) => ({ ...prev, badge: v === NONE_VALUE ? null : v }))
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

        <div className="grid gap-1.5">
          <Label htmlFor="sortOrder">정렬순서 (낮을수록 위)</Label>
          <Input
            id="sortOrder"
            type="number"
            value={form.sortOrder ?? ''}
            onChange={setNum('sortOrder')}
          />
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

        <div className="flex justify-end gap-2">
          {onCancel && (
            <Button
              variant="outline"
              onClick={onCancel}
              disabled={updateMutation.isPending}
            >
              취소
            </Button>
          )}
          <Button onClick={handleSave} disabled={updateMutation.isPending}>
            저장
          </Button>
        </div>
      </div>
    </div>
  );
}
