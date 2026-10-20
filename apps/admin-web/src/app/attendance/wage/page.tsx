import RouteGuard from '@/components/layout/route-guard';
import { AttendancePageLayout } from '@/features/attendance/components/attendance-page-layout';
import { MyWage } from '@/features/attendance/wage/my-wage';

export default function Page() {
  return (
    <RouteGuard screen="/attendance/wage">
      <AttendancePageLayout title="내 급여">
        <MyWage />
      </AttendancePageLayout>
    </RouteGuard>
  );
}
