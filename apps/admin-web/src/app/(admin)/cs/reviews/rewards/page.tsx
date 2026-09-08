import RouteGuard from '@/components/layout/route-guard';
import ReviewRewardTemplate from '@/features/cs/review-reward/template';

export default function ReviewRewardsPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <ReviewRewardTemplate />
      </div>
    </RouteGuard>
  );
}
