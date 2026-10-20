import RouteGuard from '@/components/layout/route-guard';
import { CorrectionRequests } from '@/features/attendance/components/correction-requests';

export default function Page() {
  return (
    <RouteGuard screen="/company/attendance/review">
      <CorrectionRequests review />
    </RouteGuard>
  );
}
