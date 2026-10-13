import RouteGuard from '@/components/layout/route-guard';
import SmsDevicesTemplate from '@/features/messages/devices/template';

export default function SmsDevicesPage() {
  return (
    <RouteGuard screen="/messages/devices">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <SmsDevicesTemplate />
      </div>
    </RouteGuard>
  );
}
