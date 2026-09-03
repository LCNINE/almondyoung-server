'use client';

import { useState } from 'react';
import { Smile } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/ui';

/**
 * 아이콘은 이모지 한 글자다. 사내 문서에서 실제로 쓰이는 것만 추려 뒀다 —
 * 전체 이모지 검색이 필요해지면 그때 별도 데이터로 옮긴다.
 */
const EMOJI_GROUPS: Array<{ label: string; emojis: string[] }> = [
  {
    label: '문서',
    emojis: [
      '📄',
      '📝',
      '📋',
      '📌',
      '📁',
      '🗂️',
      '📚',
      '📖',
      '🗒️',
      '🧾',
      '🔖',
      '🏷️',
    ],
  },
  {
    label: '업무',
    emojis: [
      '📦',
      '🚚',
      '🏭',
      '🛒',
      '💳',
      '💰',
      '📊',
      '📈',
      '📉',
      '🧮',
      '🗓️',
      '⏱️',
    ],
  },
  {
    label: '상태',
    emojis: [
      '✅',
      '❗',
      '⚠️',
      '🚧',
      '🔒',
      '🔑',
      '🔍',
      '💡',
      '🎯',
      '🔥',
      '⭐',
      '🧭',
    ],
  },
  {
    label: '사람·소통',
    emojis: [
      '🙋',
      '👥',
      '🤝',
      '📣',
      '💬',
      '📞',
      '✉️',
      '🧑‍💻',
      '🧑‍🏫',
      '🧑‍🔧',
      '🎧',
      '🏢',
    ],
  },
];

type Props = {
  icon: string | null;
  onChange: (icon: string | null) => void;
  disabled?: boolean;
};

export function IconPicker({ icon, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={icon ? '문서 아이콘 바꾸기' : '문서 아이콘 추가'}
          className={cn(
            'flex size-16 items-center justify-center rounded-lg text-5xl leading-none transition-colors duration-150',
            'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            !icon && 'size-9 text-muted-foreground'
          )}
        >
          {icon ? icon : <Smile className="size-5" aria-hidden />}
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-80 p-3">
        <div className="max-h-72 space-y-3 overflow-y-auto">
          {EMOJI_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="pb-1 text-xs font-medium text-muted-foreground">
                {group.label}
              </p>
              <div className="grid grid-cols-8 gap-1">
                {group.emojis.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    aria-label={`아이콘 ${emoji} 선택`}
                    onClick={() => {
                      onChange(emoji);
                      setOpen(false);
                    }}
                    className={cn(
                      'flex size-8 items-center justify-center rounded text-xl leading-none hover:bg-muted',
                      emoji === icon && 'bg-muted ring-1 ring-ring'
                    )}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-2 w-full"
          disabled={!icon}
          onClick={() => {
            onChange(null);
            setOpen(false);
          }}
        >
          아이콘 없애기
        </Button>
      </PopoverContent>
    </Popover>
  );
}
