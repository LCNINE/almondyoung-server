import RouteGuard from '@/components/layout/route-guard';
import { WorksiteSettings } from '@/features/attendance/components/attendance-settings';

export default function Page() {
  return (
    <RouteGuard requireRole={['master']}>
      <WorksiteSettings />
    </RouteGuard>
  );
}
