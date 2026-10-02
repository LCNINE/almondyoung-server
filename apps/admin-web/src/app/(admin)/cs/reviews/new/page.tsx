import RouteGuard from '@/components/layout/route-guard';
import { AdminReviewCreateForm } from '@/features/cs/review/components/admin-review-create-form';

export default function ReviewCreatePage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[960px] flex-col gap-y-2 p-3">
        <AdminReviewCreateForm />
      </div>
    </RouteGuard>
  );
}
