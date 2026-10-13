import RouteGuard from '@/components/layout/route-guard';
import StatisticsSettingsTemplate from '@/features/statistics/template/settings';

export default function StatisticsSettingsPage() {
  return (
    <RouteGuard screen="/statistics/settings">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <StatisticsSettingsTemplate />
      </div>
    </RouteGuard>
  );
}
