import RouteGuard from '@/components/layout/route-guard';
import { WageSettlement } from '@/features/attendance/wage/wage-settlement';
import { WageTabs } from '@/features/attendance/wage/wage-ui';

export default function Page() {
  return (
    <RouteGuard screen="/company/attendance/wage">
      <WageTabs />
      <WageSettlement />
    </RouteGuard>
  );
}
