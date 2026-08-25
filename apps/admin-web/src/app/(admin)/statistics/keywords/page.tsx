import RouteGuard from '@/components/layout/route-guard';
import KeywordStatisticsTemplate from '@/features/statistics/template/keywords';

export default function StatisticsKeywordsPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <KeywordStatisticsTemplate />
      </div>
    </RouteGuard>
  );
}
