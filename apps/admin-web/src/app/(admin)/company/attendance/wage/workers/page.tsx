import RouteGuard from '@/components/layout/route-guard';
import { WageWorkers } from '@/features/attendance/wage/wage-workers';
import { WageTabs } from '@/features/attendance/wage/wage-ui';

export default function Page() {
  return (
    <RouteGuard screen="/company/attendance/wage/workers">
      <WageTabs />
      <WageWorkers />
    </RouteGuard>
  );
}
