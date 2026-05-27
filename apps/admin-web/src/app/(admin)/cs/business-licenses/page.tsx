import RouteGuard from '@/components/layout/route-guard';
import BusinessLicenseListTemplate from '@/features/cs/business-licenses/template';

export default function BusinessLicensesPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <BusinessLicenseListTemplate />
      </div>
    </RouteGuard>
  );
}
