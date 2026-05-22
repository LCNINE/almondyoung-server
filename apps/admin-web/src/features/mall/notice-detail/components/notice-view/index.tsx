'use client';

import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { NoticeDto } from '@/lib/types/dto/products';
import { sanitizeNoticeHtml } from '@/lib/utils/sanitize-notice-html';

type Props = {
  notice: NoticeDto;
  onEdit: () => void;
};

const CATEGORY_LABEL: Record<string, string> = {
  general: '일반',
  event: '이벤트',
  delivery: '배송',
  service: '서비스',
};

const BADGE_LABEL: Record<string, string> = {
  important: '중요',
  urgent: '긴급',
  new: '신규',
};

const formatDateTime = (iso: string | null): string => {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export function NoticeView({ notice, onEdit }: Props) {
  const period =
    notice.displayStartAt || notice.displayEndAt
      ? `${formatDateTime(notice.displayStartAt)} ~ ${formatDateTime(notice.displayEndAt)}`
      : '상시 게시';

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-end">
        <Button onClick={onEdit}>
          <Pencil />
          수정
        </Button>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Badge variant={notice.isActive ? 'default' : 'secondary'}>
          {notice.isActive ? '공개' : '비공개'}
        </Badge>
        {notice.isPinned && <Badge variant="outline">상단 고정</Badge>}
        <Badge variant="outline">
          {CATEGORY_LABEL[notice.category] ?? notice.category}
        </Badge>
        {notice.badge && (
          <Badge variant="outline">
            {BADGE_LABEL[notice.badge] ?? notice.badge}
          </Badge>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          게시 기간: {period}
        </span>
      </div>

      <article
        className="notice-content max-w-3xl text-sm leading-6"
        dangerouslySetInnerHTML={{ __html: sanitizeNoticeHtml(notice.content) }}
      />
    </div>
  );
}
