import RouteGuard from '@/components/layout/route-guard';
import { WageDecisions } from '@/features/attendance/wage/wage-decisions';
import { WageTabs } from '@/features/attendance/wage/wage-ui';

export default function Page() {
  return (
    <RouteGuard screen="/company/attendance/wage/decisions">
      <WageTabs />
      <WageDecisions />
    </RouteGuard>
  );
}
