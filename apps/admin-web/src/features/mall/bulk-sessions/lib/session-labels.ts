import type { BulkSessionPhase } from '@/lib/types/dto/bulk-session';

export const PHASE_LABELS: Record<BulkSessionPhase, string> = {
  uploaded: '접수됨',
  validating: '검증 중',
  review: '검토 대기',
  awaiting_images: '이미지 대기',
  drafting: '임시 버전 생성 중',
  drafted: '검토 가능',
  publishing: '발행 중',
  published: '발행 완료',
  canceled: '취소됨',
  failed: '실패',
};

export function phaseLabel(phase: BulkSessionPhase): string {
  return PHASE_LABELS[phase];
}

/** shadcn Badge variant. 사람의 손이 필요한 단계를 눈에 띄게 한다. */
export function phaseBadgeVariant(
  phase: BulkSessionPhase
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (phase === 'failed') return 'destructive';
  if (phase === 'review' || phase === 'awaiting_images' || phase === 'drafted')
    return 'default';
  if (phase === 'published') return 'secondary';
  return 'outline';
}
