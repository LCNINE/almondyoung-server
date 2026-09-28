'use client';

import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ConversationSummary } from '@/lib/api/domains/sms-gate';
import { cn } from '@/lib/utils/cn';
import { formatPhoneNumber } from '@/lib/utils/phone';

export function ConversationList({
  conversations,
  selectedPhone,
  onSelect,
}: {
  conversations: ConversationSummary[];
  selectedPhone: string | null;
  onSelect: (phoneNumber: string) => void;
}) {
  if (conversations.length === 0) {
    return (
      <div className="text-muted-foreground flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed px-4 py-8 text-center text-sm">
        메시지가 없습니다.
      </div>
    );
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <ul className="flex flex-col gap-1 pr-3">
        {conversations.map((conversation) => (
          <li key={conversation.phoneNumber} className="min-w-0">
            <button
              type="button"
              aria-current={conversation.phoneNumber === selectedPhone}
              onClick={() => onSelect(conversation.phoneNumber)}
              className={cn(
                'flex w-full min-w-0 flex-col gap-1 rounded-lg p-2 text-left transition-colors',
                conversation.phoneNumber === selectedPhone ? 'bg-accent' : 'hover:bg-accent/60'
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-semibold">
                  {conversation.name ?? formatPhoneNumber(conversation.phoneNumber)}
                  {!conversation.userId && (
                    <span className="text-muted-foreground pl-1 text-xs font-normal">비회원</span>
                  )}
                </span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {formatDistanceToNow(new Date(conversation.lastMessage.receivedAt), { addSuffix: true, locale: ko })}
                </span>
              </span>
              <span className="text-muted-foreground truncate text-sm">{conversation.lastMessage.text}</span>
            </button>
          </li>
        ))}
      </ul>
    </ScrollArea>
  );
}
