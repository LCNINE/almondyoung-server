import RouteGuard from '@/components/layout/route-guard';
import ReturnsTemplate from '@/features/inventory/returns/template';

export default function ReturnsPage() {
  return (
    <RouteGuard screen="/inventory/returns">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <ReturnsTemplate />
      </div>
    </RouteGuard>
  );
}
