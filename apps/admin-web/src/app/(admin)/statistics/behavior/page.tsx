import RouteGuard from '@/components/layout/route-guard';
import BehaviorStatisticsTemplate from '@/features/statistics/template/behavior';

export default function StatisticsBehaviorPage() {
  return (
    <RouteGuard screen="/statistics/behavior">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <BehaviorStatisticsTemplate />
      </div>
    </RouteGuard>
  );
}
