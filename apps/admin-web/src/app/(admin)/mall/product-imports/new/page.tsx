import RouteGuard from '@/components/layout/route-guard';
import ImportWizard from '@/features/mall/product-imports/wizard';

export default function ProductImportNewPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <ImportWizard />
      </div>
    </RouteGuard>
  );
}
