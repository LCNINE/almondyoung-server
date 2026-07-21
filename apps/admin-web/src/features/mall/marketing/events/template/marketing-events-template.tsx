'use client';

import { useState } from 'react';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  useCouponEventList,
  useDeleteCouponEvent,
} from '@/lib/services/coupon-events';
import type { CouponEvent } from '@/lib/api/domains/medusa/coupon-events';
import { EventFormDialog } from '../components/event-form-dialog';
import { toast } from 'sonner';
import { CalendarClock, Copy, Check, Pencil, Trash2, Ticket, ImageOff } from 'lucide-react';

const STOREFRONT_URL = process.env.NEXT_PUBLIC_STOREFRONT_URL ?? '';
const DEFAULT_COUNTRY = process.env.NEXT_PUBLIC_STOREFRONT_DEFAULT_COUNTRY ?? 'kr';

function eventUrl(slug: string): string {
  const base = STOREFRONT_URL.replace(/\/$/, '');
  return `${base}/${DEFAULT_COUNTRY}/events/${slug}`;
}

function formatPeriod(e: CouponEvent): string {
  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' }) : null;
  const s = fmt(e.starts_at);
  const en = fmt(e.ends_at);
  if (s && en) return `${s} ~ ${en}`;
  if (en) return `~ ${en}`;
  if (s) return `${s} ~`;
  return '상시';
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'active') return <Badge className="bg-green-100 text-green-700 border-0">활성</Badge>;
  if (status === 'ended') return <Badge className="bg-gray-100 text-gray-500 border-0">종료</Badge>;
  return <Badge className="bg-yellow-100 text-yellow-700 border-0">초안</Badge>;
}

export default function MarketingEventsTemplate() {
  const { data, isLoading } = useCouponEventList();
  const deleteEvent = useDeleteCouponEvent();
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  const events = data?.events ?? [];

  const openCreate = () => {
    setEditId(null);
    setFormOpen(true);
  };
  const openEdit = (id: string) => {
    setEditId(id);
    setFormOpen(true);
  };

  const handleCopy = async (slug: string) => {
    await navigator.clipboard.writeText(eventUrl(slug));
    setCopiedSlug(slug);
    toast.success('이벤트 링크를 복사했습니다.');
    setTimeout(() => setCopiedSlug(null), 2000);
  };

  const handleDelete = async (e: CouponEvent) => {
    if (!confirm(`"${e.title}" 이벤트를 삭제할까요?`)) return;
    try {
      await deleteEvent.mutateAsync(e.id);
      toast.success('이벤트가 삭제되었습니다.');
    } catch {
      toast.error('삭제에 실패했습니다.');
    }
  };

  return (
    <Container className="divide-y-0">
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b">
        <div>
          <h2 className="text-base font-semibold">이벤트</h2>
          <p className="text-sm text-muted-foreground">배너에 걸어 여러 쿠폰을 한 페이지에서 발급받게 합니다.</p>
        </div>
        <Button onClick={openCreate} className="bg-orange-500 text-white hover:bg-orange-600">
          <Ticket className="h-4 w-4 mr-1.5" />
          이벤트 만들기
        </Button>
      </div>

      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">불러오는 중...</div>
      ) : events.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
          <Ticket className="h-10 w-10 opacity-30" />
          <p className="text-sm">생성된 이벤트가 없습니다.</p>
        </div>
      ) : (
        <ul className="divide-y">
          {events.map((e) => (
            <li key={e.id} className="flex items-center gap-4 px-4 py-3">
              <div className="h-14 w-24 shrink-0 overflow-hidden rounded-md border bg-muted">
                {e.banner_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={e.banner_image_url} alt={e.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                    <ImageOff className="h-5 w-5" />
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{e.title}</span>
                  <StatusBadge status={e.status} />
                </div>
                <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Ticket className="h-3.5 w-3.5" /> 쿠폰 {e.item_count ?? 0}개
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <CalendarClock className="h-3.5 w-3.5" /> {formatPeriod(e)}
                  </span>
                  <span className="font-mono">/{e.slug}</span>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => handleCopy(e.slug)}>
                  {copiedSlug === e.slug ? <Check className="h-3.5 w-3.5 mr-1 text-green-500" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
                  링크
                </Button>
                <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => openEdit(e.id)}>
                  <Pencil className="h-3.5 w-3.5 mr-1" />
                  수정
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                  onClick={() => handleDelete(e)}
                  disabled={deleteEvent.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <EventFormDialog open={formOpen} onOpenChange={setFormOpen} eventId={editId} />
    </Container>
  );
}
