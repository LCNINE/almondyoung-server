import RouteGuard from '@/components/layout/route-guard';
import CSManagementClient from './cs-management.client';

export default function CSManagementPage() {
  return (
    <RouteGuard screen="/cs/management">
      <CSManagementClient />
    </RouteGuard>
  );
}
