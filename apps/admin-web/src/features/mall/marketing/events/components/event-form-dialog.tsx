'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useCouponList } from '@/lib/services/coupons';
import {
  useCouponEvent,
  useCreateCouponEvent,
  useUpdateCouponEvent,
} from '@/lib/services/coupon-events';
import { uploadFileToFileService, PRODUCT_IMAGE_CONTEXT_ID } from '@/lib/api/domains/files/upload.client';
import type { CouponEventStatus } from '@/lib/api/domains/medusa/coupon-events';
import { getCouponMeta } from '../../coupons/coupon-helpers';
import { toast } from 'sonner';
import { X, ImagePlus, Search } from 'lucide-react';

interface EventFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId?: string | null; // 있으면 편집 모드
}

// datetime-local <-> ISO 변환
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}
function fromLocalInput(v: string): string | null {
  if (!v) return null;
  return new Date(v).toISOString();
}

export function EventFormDialog({ open, onOpenChange, eventId }: EventFormDialogProps) {
  const isEdit = !!eventId;
  const { data: detail } = useCouponEvent(open && eventId ? eventId : null);
  const { data: couponData } = useCouponList({ limit: 200 });
  const createEvent = useCreateCouponEvent();
  const updateEvent = useUpdateCouponEvent();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<CouponEventStatus>('draft');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);

  // 편집 모드 프리필
  useEffect(() => {
    if (!open) return;
    if (isEdit && detail) {
      setTitle(detail.event.title);
      setDescription(detail.event.description ?? '');
      setBannerUrl(detail.event.banner_image_url);
      setStatus(detail.event.status);
      setStartsAt(toLocalInput(detail.event.starts_at));
      setEndsAt(toLocalInput(detail.event.ends_at));
      setSelectedIds(detail.items.map((i) => i.promotion_id));
    } else if (!isEdit) {
      setTitle('');
      setDescription('');
      setBannerUrl(null);
      setStatus('draft');
      setStartsAt('');
      setEndsAt('');
      setSelectedIds([]);
    }
  }, [open, isEdit, detail]);

  const coupons = couponData?.promotions ?? [];
  const couponById = useMemo(() => new Map(coupons.map((c) => [c.id, c])), [coupons]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return coupons.filter((c) => !q || c.code.toLowerCase().includes(q));
  }, [coupons, search]);

  const toggle = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const res = await uploadFileToFileService(file, { contextId: PRODUCT_IMAGE_CONTEXT_ID, isPublic: true });
      setBannerUrl(res.url);
    } catch {
      toast.error('배너 업로드에 실패했습니다.');
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast.error('제목을 입력해주세요.');
      return;
    }
    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      banner_image_url: bannerUrl,
      starts_at: fromLocalInput(startsAt),
      ends_at: fromLocalInput(endsAt),
      status,
      promotion_ids: selectedIds,
    };
    try {
      if (isEdit && eventId) {
        await updateEvent.mutateAsync({ id: eventId, payload });
        toast.success('이벤트가 수정되었습니다.');
      } else {
        await createEvent.mutateAsync(payload);
        toast.success('이벤트가 생성되었습니다.');
      }
      onOpenChange(false);
    } catch {
      toast.error('저장에 실패했습니다.');
    }
  };

  const pending = createEvent.isPending || updateEvent.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? '이벤트 수정' : '이벤트 만들기'}</DialogTitle>
          <DialogDescription>
            배너에 걸어 여러 쿠폰을 한 페이지에서 발급받게 하는 쿠폰 이벤트입니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>제목</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 브랜드데이 30% 쿠폰팩" />
          </div>

          <div className="space-y-1.5">
            <Label>설명 (선택)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="이벤트 안내 문구"
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <Label>배너 이미지 (선택)</Label>
            {bannerUrl ? (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={bannerUrl} alt="배너" className="w-full rounded-lg border object-cover max-h-40" />
                <button
                  type="button"
                  onClick={() => setBannerUrl(null)}
                  className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed py-6 text-sm text-muted-foreground hover:bg-muted/40">
                <ImagePlus className="h-4 w-4" />
                {uploading ? '업로드 중...' : '이미지 업로드'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
                />
              </label>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>노출 시작 (선택)</Label>
              <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>노출 종료 (선택)</Label>
              <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>상태</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as CouponEventStatus)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">초안 (비공개)</SelectItem>
                <SelectItem value="active">활성 (공개)</SelectItem>
                <SelectItem value="ended">종료</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>담을 쿠폰 ({selectedIds.length})</Label>
            {selectedIds.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {selectedIds.map((id) => {
                  const c = couponById.get(id);
                  return (
                    <Badge key={id} variant="secondary" className="gap-1">
                      {c?.code ?? id}
                      <button type="button" onClick={() => toggle(id)}><X className="h-3 w-3" /></button>
                    </Badge>
                  );
                })}
              </div>
            )}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="쿠폰 코드 검색..."
                className="pl-8 h-9"
              />
            </div>
            <ScrollArea className="h-44 rounded-lg border">
              <ul className="divide-y">
                {filtered.map((c) => {
                  const { visibility } = getCouponMeta(c);
                  const checked = selectedIds.includes(c.id);
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => toggle(c.id)}
                        className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted/40 ${checked ? 'bg-orange-50' : ''}`}
                      >
                        <span className="font-mono">{c.code}</span>
                        <span className="text-xs text-muted-foreground">
                          {visibility === 'claimable' ? '발급받기' : visibility === 'assigned_only' ? '지정발급' : '공개'}
                        </span>
                      </button>
                    </li>
                  );
                })}
                {filtered.length === 0 && (
                  <li className="px-3 py-6 text-center text-sm text-muted-foreground">쿠폰이 없습니다.</li>
                )}
              </ul>
            </ScrollArea>
            <p className="text-xs text-muted-foreground">발급받기(claimable) 쿠폰을 담아야 고객이 이벤트 페이지에서 발급받을 수 있습니다.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button onClick={handleSubmit} disabled={pending} className="bg-orange-500 text-white hover:bg-orange-600">
            {pending ? '저장 중...' : isEdit ? '수정' : '생성'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
