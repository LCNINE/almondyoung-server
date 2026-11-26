import RouteGuard from '@/components/layout/route-guard';
import DeviceWorkTemplate from '@/features/device-work/template';

export default function DeviceWorkPage() {
  return (
    <RouteGuard screen="/inventory/device-work">
      <DeviceWorkTemplate />
    </RouteGuard>
  );
}
