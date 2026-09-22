'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Crown, Megaphone, PhoneCall, ShoppingBag, User, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import type { NotificationEvent, NotificationTemplate } from '@/lib/api/domains/notification';
import {
  useNotificationEvents,
  useNotificationTemplates,
  useUpdateNotificationEvent,
} from '@/lib/services/notification';
import { cn } from '@/lib/utils/cn';
import { NOTIFICATION_CATALOG, NOTIFICATION_GROUPS, type CatalogEntry, type NotificationGroup } from '../catalog';
import { ChannelBadges } from '../components/channel-badges';
import { PreviewDialog, type PreviewTarget } from '../components/preview-dialog';

const GROUP_ICON: Record<NotificationGroup, { icon: LucideIcon; tone: string }> = {
  주문: { icon: ShoppingBag, tone: 'bg-sky-50 text-sky-600' },
  CS: { icon: PhoneCall, tone: 'bg-fuchsia-50 text-fuchsia-600' },
  회원: { icon: User, tone: 'bg-teal-50 text-teal-600' },
  멤버십: { icon: Crown, tone: 'bg-amber-50 text-amber-600' },
  광고: { icon: Megaphone, tone: 'bg-orange-50 text-orange-600' },
};

export default function NotificationSettingsTemplate() {
  const events = useNotificationEvents();
  const templates = useNotificationTemplates();
  const updateEvent = useUpdateNotificationEvent();
  const [preview, setPreview] = useState<PreviewTarget | null>(null);

  const eventByKey = new Map((events.data ?? []).map((e) => [e.eventKey, e]));
  const templateByKey = new Map((templates.data ?? []).map((t) => [t.templateKey, t]));

  const toggle = (event: NotificationEvent, isActive: boolean) =>
    updateEvent.mutate(
      { eventKey: event.eventKey, values: { isActive } },
      {
        onSuccess: () => toast.success(`${event.name} 발송을 ${isActive ? '켰' : '껐'}습니다.`),
        onError: (error) => toast.error(error.message || '발송 설정을 바꾸지 못했습니다.'),
      }
    );

  return (
    <Container>
      <Header
        title="메시지 관리"
        subtitle="주문·회원 활동에 맞춰 자동으로 나가는 메일·알림톡·문자입니다. 끄면 다음 발송부터 나가지 않습니다."
      />

      <div className="flex flex-col gap-8 px-6 pb-6">
        {(events.isLoading || templates.isLoading) && <Skeleton className="h-64 w-full" />}
        {(events.isError || templates.isError) && (
          <p className="text-destructive text-sm">자동 알림 설정을 불러오지 못했습니다.</p>
        )}
        {events.data &&
          templates.data &&
          NOTIFICATION_GROUPS.map((group) => (
            <section key={group} className="flex flex-col gap-3">
              <h3 className="border-b pb-2 font-semibold">{group}</h3>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {NOTIFICATION_CATALOG.filter((entry) => entry.group === group).map((entry) => (
                  <NotificationCard
                    key={entry.id}
                    entry={entry}
                    event={entry.kind === 'event' ? eventByKey.get(entry.eventKey) : undefined}
                    templateByKey={templateByKey}
                    busy={updateEvent.isPending}
                    onToggle={toggle}
                    onPreview={setPreview}
                  />
                ))}
              </div>
            </section>
          ))}
      </div>

      <PreviewDialog target={preview} onClose={() => setPreview(null)} />
    </Container>
  );
}

function NotificationCard({
  entry,
  event,
  templateByKey,
  busy,
  onToggle,
  onPreview,
}: {
  entry: CatalogEntry;
  event: NotificationEvent | undefined;
  templateByKey: Map<string, NotificationTemplate>;
  busy: boolean;
  onToggle: (event: NotificationEvent, isActive: boolean) => void;
  onPreview: (target: PreviewTarget) => void;
}) {
  const { icon: Icon, tone } = GROUP_ICON[entry.group];
  const template = event ? templateByKey.get(event.templateKey) : undefined;
  const missing = entry.kind === 'event' && !event;

  return (
    <div className={cn('flex flex-col rounded-lg border bg-white', entry.kind === 'planned' && 'bg-gray-50')}>
      <div className="flex flex-1 gap-3 p-4">
        <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-md', tone)}>
          <Icon className="size-4" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-start justify-between gap-2">
            <span className="font-medium">{entry.title}</span>
            {event && (
              <Switch
                checked={event.isActive}
                disabled={busy}
                onCheckedChange={(checked) => onToggle(event, checked)}
                aria-label={`${entry.title} 발송`}
                className="data-[state=checked]:bg-emerald-500"
              />
            )}
          </div>
          <p className="text-muted-foreground text-xs">{entry.condition}</p>
          <div className="mt-auto flex flex-wrap gap-1 pt-1">
            {event && <ChannelBadges channels={event.defaultChannels} />}
            {missing && <Badge variant="outline">발송 설정 없음</Badge>}
            {entry.kind === 'planned' && <Badge variant="outline">준비 중 · #{entry.issue}</Badge>}
            {entry.kind === 'fixed' && <Badge variant="outline">고정 문구 · 수정 불가</Badge>}
          </div>
        </div>
      </div>
      <div className="flex min-h-12 items-center justify-end gap-2 border-t px-4 py-2">
        {event && (
          <Button asChild variant="outline" size="sm">
            <Link href={`/mall/marketing/messages/${event.eventKey}`}>메시지 수정</Link>
          </Button>
        )}
        {event && template && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPreview({ title: entry.title, template, channels: event.defaultChannels })}
          >
            미리보기
          </Button>
        )}
        {entry.kind === 'fixed' && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPreview({ title: entry.title, fixed: { channel: entry.channel, text: entry.text } })}
          >
            미리보기
          </Button>
        )}
        {(entry.kind === 'planned' || missing) && (
          <>
            <Button variant="outline" size="sm" disabled>
              메시지 수정
            </Button>
            <Button variant="outline" size="sm" disabled>
              미리보기
            </Button>
          </>
        )}
        {entry.kind === 'link' && (
          <Button asChild variant="outline" size="sm">
            <Link href={entry.href}>{entry.linkLabel}</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
