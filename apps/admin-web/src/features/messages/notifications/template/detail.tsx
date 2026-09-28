'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, Loader } from 'lucide-react';
import { toast } from 'sonner';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import type { ChannelBody, NotificationChannel } from '@/lib/api/domains/notification';
import {
  useEmailLayout,
  useNotificationEvents,
  useNotificationTemplates,
  useResetTemplateToDefault,
  useUpdateNotificationEvent,
  useUpdateTemplateContents,
} from '@/lib/services/notification';
import { NOTIFICATION_CATALOG } from '../catalog';
import { CHANNEL_LABEL } from '../components/channel-badges';
import { MailImageUploadButton } from '../components/mail-image-upload-button';
import { MessagePreview } from '../components/message-preview';
import { channelBody, unknownVariables, variableNames, withChannelBody } from '../lib/render';

const PLANNED_CHANNELS: { channel: NotificationChannel; reason: string }[] = [
  {
    channel: 'KAKAO',
    reason: '카카오 검수를 받은 알림톡 템플릿을 연결해야 합니다',
  },
  {
    channel: 'SMS',
    reason: '이 알림은 아직 받는 사람의 휴대폰 번호를 함께 넘기지 않습니다',
  },
];

export default function NotificationDetailTemplate({ eventKey }: { eventKey: string }) {
  const events = useNotificationEvents();
  const templates = useNotificationTemplates();
  const updateEvent = useUpdateNotificationEvent();
  const updateTemplate = useUpdateTemplateContents();
  const resetTemplate = useResetTemplateToDefault();
  const emailLayout = useEmailLayout();
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const event = events.data?.find((e) => e.eventKey === eventKey);
  const template = templates.data?.find((t) => t.templateKey === event?.templateKey);
  const entry = NOTIFICATION_CATALOG.find((c) => c.kind === 'event' && c.eventKey === eventKey);
  const saved = channelBody(template?.contents, 'EMAIL');

  const savedSubject = saved?.subject ?? '';
  const savedBody = saved?.body ?? '';

  const [draft, setDraft] = useState<ChannelBody>({ subject: '', body: '' });
  useEffect(() => {
    setDraft({ subject: savedSubject, body: savedBody });
  }, [savedSubject, savedBody]);

  if (events.isLoading || templates.isLoading) {
    return (
      <Container>
        <Skeleton className="m-6 h-96" />
      </Container>
    );
  }
  if (!event || !template) {
    return (
      <Container>
        <Header title="메시지 관리" />
        <p className="text-destructive px-6 pb-6 text-sm">이 알림의 발송 설정이나 템플릿을 찾지 못했습니다.</p>
      </Container>
    );
  }

  const known = [
    ...new Set([...Object.keys(template.variablesSchema ?? {}), ...variableNames(`${savedSubject} ${savedBody}`)]),
  ];
  const unknown = unknownVariables(`${draft.subject ?? ''} ${draft.body}`, known);
  const dirty = draft.body !== savedBody || (draft.subject ?? '') !== savedSubject;
  const emailOn = event.defaultChannels.includes('EMAIL');

  const setEmail = (on: boolean) =>
    updateEvent.mutate(
      {
        eventKey,
        values: {
          defaultChannels: on
            ? [...event.defaultChannels, 'EMAIL']
            : event.defaultChannels.filter((c) => c !== 'EMAIL'),
        },
      },
      {
        onError: (error) => toast.error(error.message || '채널을 바꾸지 못했습니다.'),
      },
    );

  const insertAtCursor = (token: string) => {
    const el = bodyRef.current;
    let caret = 0;
    setDraft((current) => {
      const at = el?.selectionStart ?? current.body.length;
      caret = at + token.length;
      return {
        ...current,
        body: current.body.slice(0, at) + token + current.body.slice(el?.selectionEnd ?? at),
      };
    });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  };

  const insertVariable = (name: string) => insertAtCursor(`{{${name}}}`);

  const resetToDefault = () => {
    if (!window.confirm('본문을 기본 메시지로 되돌릴까요? 저장하지 않은 수정 내용도 사라집니다.')) return;
    resetTemplate.mutate(template.templateId, {
      onSuccess: (restored) => {
        const restoredBody = channelBody(restored.contents, 'EMAIL');
        setDraft({
          subject: restoredBody?.subject ?? '',
          body: restoredBody?.body ?? '',
        });
        toast.success('기본 메시지를 적용했습니다.');
      },
      onError: (error) => toast.error(error.message || '기본 메시지를 적용하지 못했습니다.'),
    });
  };

  const save = () =>
    updateTemplate.mutate(
      {
        templateId: template.templateId,
        contents: withChannelBody(template.contents, 'EMAIL', draft),
      },
      {
        onSuccess: () => toast.success('저장했습니다. 다음 발송부터 반영됩니다.'),
        onError: (error) => toast.error(error.message || '저장하지 못했습니다.'),
      },
    );

  return (
    <Container>
      <Header
        title={entry?.title ?? event.name}
        subtitle={entry?.condition ?? event.description}
        titleAside={
          <Badge variant={event.isActive ? 'default' : 'secondary'}>{event.isActive ? '발송 중' : '꺼짐'}</Badge>
        }
        right={
          <Button asChild variant="outline" size="sm">
            <Link href="/mall/marketing/messages">
              <ChevronLeft className="size-4" />
              목록으로
            </Link>
          </Button>
        }
      />

      <div className="flex flex-col gap-6 px-6 pb-6">
        <section className="flex flex-col gap-3 rounded-md border px-4 py-3">
          <div className="flex items-center gap-4">
            <Label className="w-28 shrink-0">보내는 채널</Label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={emailOn}
                disabled={updateEvent.isPending}
                onCheckedChange={(v) => setEmail(v === true)}
              />
              {CHANNEL_LABEL.EMAIL}
            </label>
            {PLANNED_CHANNELS.map(({ channel, reason }) => (
              <label key={channel} className="text-muted-foreground flex items-center gap-2 text-sm" title={reason}>
                <Checkbox checked={event.defaultChannels.includes(channel)} disabled />
                {CHANNEL_LABEL[channel]} (준비 중)
              </label>
            ))}
          </div>
          <p className="text-muted-foreground text-xs">
            알림톡은 {PLANNED_CHANNELS[0].reason}. SMS 는 {PLANNED_CHANNELS[1].reason}.
          </p>
        </section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="flex flex-col gap-3">
            <h3 className="font-semibold">메일 수정</h3>
            <div className="flex flex-col gap-2">
              <Label htmlFor="mail-subject">제목</Label>
              <Input
                id="mail-subject"
                value={draft.subject ?? ''}
                onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
              />
            </div>
            <div className="flex flex-1 flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="mail-body">본문 (마크다운)</Label>
                <MailImageUploadButton onInsert={insertAtCursor} />
              </div>
              <Textarea
                id="mail-body"
                ref={bodyRef}
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                className="min-h-[420px] flex-1 font-mono text-xs"
              />
              <p className="text-muted-foreground text-xs">
                ## 제목 · **굵게** · - 목록 · [링크](주소) · 표 · ![이미지](주소) 를 쓸 수 있습니다. 로고와 푸터는{' '}
                <Link href="/mall/marketing/messages/layout-settings" className="underline">
                  메일 양식
                </Link>
                에서 한 번에 바꿉니다.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground text-xs">변수 넣기</span>
              {known.map((name) => (
                <Button
                  key={name}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => insertVariable(name)}
                >
                  {`{{${name}}}`}
                </Button>
              ))}
            </div>
            {unknown.length > 0 && (
              <p className="text-destructive text-xs">
                이 알림이 채워주지 않는 변수가 있습니다: {unknown.map((n) => `{{${n}}}`).join(', ')} — 발송하면 빈칸으로
                나갑니다.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={template.hasDefaultContents === false || resetTemplate.isPending}
                onClick={resetToDefault}
              >
                {resetTemplate.isPending ? <Loader className="animate-spin" /> : '기본 메시지 적용'}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!dirty || updateTemplate.isPending}
                onClick={() => setDraft({ subject: savedSubject, body: savedBody })}
              >
                수정 초기화
              </Button>
              <Button type="button" disabled={!dirty || !draft.body.trim() || updateTemplate.isPending} onClick={save}>
                {updateTemplate.isPending ? <Loader className="animate-spin" /> : '저장'}
              </Button>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="font-semibold">미리보기</h3>
            <MessagePreview
              channel="EMAIL"
              subject={draft.subject}
              body={draft.body}
              advertising={event.category === 'MARKETING'}
              settings={emailLayout.data}
            />
            <p className="text-muted-foreground text-xs">[변수명] 자리에는 실제 발송 때 고객 정보가 들어갑니다.</p>
          </section>
        </div>
      </div>
    </Container>
  );
}
