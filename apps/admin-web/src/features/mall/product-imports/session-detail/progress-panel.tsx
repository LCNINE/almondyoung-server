'use client';

import { Progress } from '@/components/ui/progress';
import { stagePercent, visibleStages } from '@/lib/services/products';
import type { ImportProgressDto } from '@/lib/types/dto/product-import';

const STATUS_LABEL: Record<string, string> = {
  idle: '대기',
  queued: '큐 대기',
  running: '진행 중',
  completed: '완료',
  failed: '실패',
  canceled: '취소됨',
};

interface Props {
  progress: ImportProgressDto;
}

export function ProgressPanel({ progress }: Props) {
  const stages = visibleStages(progress);

  if (stages.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        진행할 단계가 없습니다 — 등록 대상 행이 없는 세션입니다.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {stages.map((stage) => (
        <div key={stage.key} className="space-y-1">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium">{stage.label}</span>
            <span className="text-muted-foreground">
              {stage.done}/{stage.total}
              {stage.failed > 0 && (
                <span className="ml-2 text-destructive">실패 {stage.failed}</span>
              )}
              <span className="ml-2">{STATUS_LABEL[stage.status] ?? stage.status}</span>
            </span>
          </div>
          <Progress value={stagePercent(stage)} />
          {stage.error && <p className="text-xs text-destructive">{stage.error}</p>}
        </div>
      ))}
    </div>
  );
}
