import { TwoColumnPage } from '@/components/admin-ui-experimental/layout';
import { ReviewDetail } from '@/features/cs/review/components/review-detail';
import { AdminCommentForm } from '@/features/cs/review/components/admin-comment-form';
import { ReviewStatusToggle } from '@/features/cs/review/components/review-status-toggle';
import RouteGuard from '@/components/layout/route-guard';

export default async function ReviewDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <TwoColumnPage>
          <ReviewDetail reviewId={id} />

          <div className="flex flex-col gap-y-2">
            <ReviewStatusToggle reviewId={id} />
            <AdminCommentForm reviewId={id} />
          </div>
        </TwoColumnPage>
      </div>
    </RouteGuard>
  );
}
