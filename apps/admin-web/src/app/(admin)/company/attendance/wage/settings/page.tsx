import RouteGuard from '@/components/layout/route-guard';
import { WageSettings } from '@/features/attendance/wage/wage-settings';
import { WageTabs } from '@/features/attendance/wage/wage-ui';

export default function Page() {
  return (
    <RouteGuard screen="/company/attendance/wage/settings">
      <WageTabs />
      <WageSettings />
    </RouteGuard>
  );
}
