'use client';

import { useQualityMetrics } from '@/lib/services/orders/queries';
import { Badge } from '@/components/ui/badge';

export function QualityMetricsCard() {
  const { data: metrics, isLoading } = useQualityMetrics();

  if (isLoading) return <p className="text-sm text-muted-foreground">메트릭 로딩 중…</p>;
  if (!metrics) return null;

  return (
    <div className="flex flex-wrap gap-3 rounded-md border p-4">
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">총 검수</span>
        <span className="text-lg font-semibold">{metrics.totalInspections}</span>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">승인율</span>
        <Badge variant="default">{(metrics.approvalRate * 100).toFixed(1)}%</Badge>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">반려율</span>
        <Badge variant="destructive">{(metrics.rejectionRate * 100).toFixed(1)}%</Badge>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">이슈 유형</span>
        <Badge variant="secondary">{metrics.commonIssues.length}</Badge>
      </div>
    </div>
  );
}
