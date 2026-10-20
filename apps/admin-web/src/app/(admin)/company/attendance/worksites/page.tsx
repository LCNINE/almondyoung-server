import RouteGuard from '@/components/layout/route-guard';
import { WorksiteSettings } from '@/features/attendance/components/attendance-settings';

export default function Page() {
  return (
    <RouteGuard screen="/company/attendance/worksites">
      <WorksiteSettings />
    </RouteGuard>
  );
}
