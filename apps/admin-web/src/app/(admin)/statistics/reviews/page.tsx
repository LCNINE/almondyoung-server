import RouteGuard from '@/components/layout/route-guard';
import ReviewStatisticsTemplate from '@/features/statistics/template/reviews';

export default function StatisticsReviewsPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <ReviewStatisticsTemplate />
      </div>
    </RouteGuard>
  );
}
