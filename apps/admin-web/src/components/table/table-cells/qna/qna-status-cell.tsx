'use client';

import { Badge } from '@/components/ui/badge';
import { QuestionStatusFilter, STATUS_LABELS } from '@/lib/types/dto/qna';

// 토스 TDS 처럼 처리할 답변 대기만 fill 로 띄우고, 끝난 상태는 회색 weak 로 가라앉힌다
const statusClassName: Record<QuestionStatusFilter, string> = {
  active: 'bg-[#F04452] font-semibold text-white',
  answered: 'bg-[#F2F4F6] text-[#4E5968]',
  deleted: 'bg-[#F9FAFB] text-[#8B95A1]',
};

type QnaStatusCellProps = {
  status: string | null | undefined;
  deletedAt?: string | null;
};

export function QnaStatusCell({ status, deletedAt }: QnaStatusCellProps) {
  if (!deletedAt && !status) {
    return <span className="text-muted-foreground">-</span>;
  }
  const key = (deletedAt ? 'deleted' : status) as QuestionStatusFilter;
  return (
    <Badge className={statusClassName[key] ?? 'bg-[#F2F4F6] text-[#4E5968]'}>
      {STATUS_LABELS[key] ?? status}
    </Badge>
  );
}
