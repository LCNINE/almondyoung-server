import RouteGuard from '@/components/layout/route-guard';
import { AttendancePageLayout } from '@/features/attendance/components/attendance-page-layout';
import { WorksiteSettings } from '@/features/attendance/components/attendance-settings';

export default function Page() {
  return (
    <RouteGuard screen="/attendance/worksites">
      <AttendancePageLayout title="근무지 관리">
        <WorksiteSettings showHeading={false} />
      </AttendancePageLayout>
    </RouteGuard>
  );
}
