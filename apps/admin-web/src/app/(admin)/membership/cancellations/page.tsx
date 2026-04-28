import RouteGuard from '@/components/layout/route-guard';
import { CancellationsTemplate } from '@/features/membership/cancellations/template';

export default function MembershipCancellationsPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <CancellationsTemplate />
      </div>
    </RouteGuard>
  );
}
