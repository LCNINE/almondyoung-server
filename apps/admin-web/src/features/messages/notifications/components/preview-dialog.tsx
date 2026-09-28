'use client';

import type { EmailLayoutSettings } from '@packages/email-layout';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { NotificationChannel, NotificationTemplate } from '@/lib/api/domains/notification';
import { channelBody } from '../lib/render';
import { CHANNEL_LABEL } from './channel-badges';
import { MessagePreview } from './message-preview';

export type PreviewTarget =
  | {
      title: string;
      template: NotificationTemplate;
      channels: NotificationChannel[];
      advertising: boolean;
    }
  | { title: string; fixed: { channel: NotificationChannel; text: string } };

export function PreviewDialog({
  target,
  settings,
  onClose,
}: {
  target: PreviewTarget | null;
  settings?: EmailLayoutSettings;
  onClose: () => void;
}) {
  const items =
    target && 'template' in target
      ? target.channels.flatMap((channel) => {
          const content = channelBody(target.template.contents, channel);
          return content ? [{ channel, ...content }] : [];
        })
      : target
        ? [{ channel: target.fixed.channel, body: target.fixed.text }]
        : [];

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{target?.title} 미리보기</DialogTitle>
          <DialogDescription>[변수명] 자리에는 실제 발송 때 고객 정보가 들어갑니다.</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
          {items.length === 0 && <p className="text-muted-foreground text-sm">등록된 본문이 없습니다.</p>}
          {items.map((item) => (
            <section key={item.channel} className="flex flex-col gap-2">
              <h4 className="text-sm font-semibold">{CHANNEL_LABEL[item.channel]}</h4>
              <MessagePreview
                channel={item.channel}
                subject={item.subject}
                body={item.body}
                advertising={target !== null && 'advertising' in target && target.advertising}
                settings={settings}
              />
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
