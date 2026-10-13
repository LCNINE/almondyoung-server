import RouteGuard from '@/components/layout/route-guard';
import ProfitStatisticsTemplate from '@/features/statistics/template/profit';

export default function StatisticsProfitPage() {
  return (
    <RouteGuard screen="/statistics/profit">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <ProfitStatisticsTemplate />
      </div>
    </RouteGuard>
  );
}
