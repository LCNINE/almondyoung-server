'use client';

import { createContext, ReactNode, useContext } from 'react';
import { MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils/ui';
import type { UserInfo } from '@/hooks/use-user-names';
import type { NoticeBadge, NoticeTone } from '../lib/recovery-view';

/** 화면에 보이는 사람들의 이름. 카드마다 따로 조회하지 않게 위에서 한 번에 모아 내려 준다. */
export const UserNamesContext = createContext<Record<string, UserInfo>>({});

export function PersonName({
  userId,
  className,
}: {
  userId: string;
  className?: string;
}) {
  const user = useContext(UserNamesContext)[userId];
  return (
    <span
      className={cn('truncate font-medium text-gray-900', className)}
      title={user?.loginId || userId}
    >
      {user?.username || user?.loginId || '이름 확인 중'}
    </span>
  );
}

const NOTICE_TONE: Record<NoticeTone, string> = {
  ok: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  pending: 'bg-sky-50 text-sky-700 ring-sky-200',
  warn: 'bg-red-50 text-red-700 ring-red-200',
  muted: 'bg-gray-50 text-gray-500 ring-gray-200',
};

export function NoticeChip({
  badge,
  prefix,
}: {
  badge: NoticeBadge;
  prefix?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset',
        NOTICE_TONE[badge.tone]
      )}
    >
      <MessageCircle className="size-3 shrink-0" aria-hidden />
      <span className="truncate">
        {prefix ? `${prefix} ` : ''}
        {badge.text}
      </span>
    </span>
  );
}

/** ●●○ — 몇 번 실패했고 몇 번 남았는지 */
export function AttemptDots({ failed, max }: { failed: number; max: number }) {
  return (
    <span
      className="inline-flex items-center gap-0.5"
      aria-label={`${max}번 중 ${failed}번 실패`}
    >
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          className={cn(
            'size-2 rounded-full',
            i < failed
              ? 'bg-red-500'
              : 'bg-gray-200 ring-1 ring-inset ring-gray-300'
          )}
        />
      ))}
    </span>
  );
}

export function SectionTitle({
  title,
  sub,
  right,
}: {
  title: string;
  sub?: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
      <h2 className="text-base font-semibold text-gray-900">
        {title}
        {sub && (
          <span className="ml-2 text-sm font-normal text-gray-500">{sub}</span>
        )}
      </h2>
      {right}
    </div>
  );
}
