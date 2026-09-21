'use client';

import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { Loader2, Smartphone } from 'lucide-react';
import type { ConversationMessage, ConversationMessageState } from '@/lib/api/domains/sms-gate';
import { cn } from '@/lib/utils/cn';

const STATE_LABEL: Record<ConversationMessageState, string> = {
  pending: '대기',
  sending: '발송 중',
  sent: '발송 완료',
  failed: '실패',
  cancelled: '취소',
};

export function MessageBubble({
  message,
  deviceName,
}: {
  message: ConversationMessage;
  deviceName: (deviceId: string) => string;
}) {
  const isOutbound = message.direction === 'outbound';
  const inProgress = message.state === 'pending' || message.state === 'sending';
  const route = message.viaNhn ? '대표번호' : message.deviceId ? deviceName(message.deviceId) : null;

  return (
    <div className={cn('flex', isOutbound ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[75%] rounded-lg px-3 py-2 shadow-sm',
          isOutbound ? 'bg-[#43A1FE] text-white' : 'bg-card text-card-foreground border'
        )}
      >
        <p className="text-sm leading-5 break-words whitespace-pre-wrap">{message.text}</p>
        <p
          className={cn(
            'mt-1 flex items-center gap-1 text-[11px]',
            isOutbound ? 'text-white/75' : 'text-muted-foreground'
          )}
        >
          {message.sentByName && <span>{message.sentByName} ·</span>}
          <span>{format(new Date(message.createdAt), 'M/d a h:mm', { locale: ko })}</span>
          {inProgress ? (
            <Loader2 className="size-3 animate-spin" aria-label={message.state ? STATE_LABEL[message.state] : ''} />
          ) : (
            message.state && <span>/ {STATE_LABEL[message.state]}</span>
          )}
          {route && (
            <span className="flex items-center gap-0.5">
              / <Smartphone className="size-3" />
              {route}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
