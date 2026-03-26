import RouteGuard from '@/components/layout/route-guard';
import CustomerListTemplate from '@/features/customers/template';

export default function CustomerPage() {
  return (
    <RouteGuard
      requireRole={['admin', 'master']}
    >
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <CustomerListTemplate />
      </div>
    </RouteGuard>
  );
}
