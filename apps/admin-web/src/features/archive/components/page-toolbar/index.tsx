'use client';

import type * as React from 'react';

import Link from 'next/link';
import {
  ChevronRight,
  Check,
  History,
  Loader2,
  Star,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils/ui';
import type { ArchiveBreadcrumbDto } from '@/lib/types/dto/archive';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

type Props = {
  breadcrumbs: ArchiveBreadcrumbDto[];
  title: string;
  icon: string | null;
  isFavorite: boolean;
  saveState: SaveState;
  savedAt: Date | null;
  onToggleFavorite: () => void;
  onOpenHistory: () => void;
  onDelete: () => void;
};

export function PageToolbar({
  breadcrumbs,
  title,
  icon,
  isFavorite,
  saveState,
  savedAt,
  onToggleFavorite,
  onOpenHistory,
  onDelete,
}: Props) {
  return (
    <div className="sticky top-0 z-10 flex h-11 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
      <nav
        aria-label="페이지 위치"
        className="flex min-w-0 flex-1 items-center gap-1 text-sm"
      >
        {breadcrumbs.map((crumb) => (
          <span key={crumb.id} className="flex min-w-0 items-center gap-1">
            <Link
              href={`/archive/${crumb.id}`}
              className="max-w-40 truncate rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {crumb.icon ? `${crumb.icon} ` : ''}
              {crumb.title || '제목 없음'}
            </Link>
            <ChevronRight
              className="size-3.5 shrink-0 text-muted-foreground/60"
              aria-hidden
            />
          </span>
        ))}
        <span
          aria-current="page"
          className="min-w-0 truncate px-1.5 py-0.5 font-medium"
        >
          {icon ? `${icon} ` : ''}
          {title || '제목 없음'}
        </span>
      </nav>

      <SaveIndicator state={saveState} savedAt={savedAt} />

      {/* 아이콘만 있는 버튼은 이름을 읽어주는 것과 별개로, 보는 사람에게도 이름이 필요하다. */}
      <IconAction
        label={isFavorite ? '즐겨찾기 해제' : '즐겨찾기에 추가'}
        onClick={onToggleFavorite}
        aria-pressed={isFavorite}
      >
        <Star
          className={cn(
            'size-4',
            isFavorite && 'fill-yellow-400 text-yellow-500'
          )}
          aria-hidden
        />
      </IconAction>

      <IconAction label="저장 이력 보기" onClick={onOpenHistory}>
        <History className="size-4" aria-hidden />
      </IconAction>

      <IconAction
        label="휴지통으로 옮기기"
        onClick={onDelete}
        className="text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="size-4" aria-hidden />
      </IconAction>
    </div>
  );
}

function IconAction({
  label,
  onClick,
  className,
  children,
  ...rest
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
} & Pick<React.ComponentProps<'button'>, 'aria-pressed'>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          onClick={onClick}
          className={cn('size-8', className)}
          {...rest}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * 자동 저장은 사용자가 «저장»을 누르지 않으므로, 지금 어떤 상태인지 늘 보이게 둔다.
 * 상태 변화는 aria-live 로 읽어 주되 방해되지 않게 polite 로 둔다.
 */
function SaveIndicator({
  state,
  savedAt,
}: {
  state: SaveState;
  savedAt: Date | null;
}) {
  return (
    <span
      aria-live="polite"
      className="hidden shrink-0 items-center gap-1 px-2 text-xs text-muted-foreground sm:flex"
    >
      {state === 'saving' ? (
        <>
          <Loader2 className="size-3 animate-spin" aria-hidden />
          저장 중…
        </>
      ) : state === 'error' ? (
        <span className="text-destructive">
          저장 실패 — 잠시 후 다시 시도돼요
        </span>
      ) : savedAt ? (
        <>
          <Check className="size-3" aria-hidden />
          {formatSavedAt(savedAt)} 저장됨
        </>
      ) : null}
    </span>
  );
}

function formatSavedAt(date: Date): string {
  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}
