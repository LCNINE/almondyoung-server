import RouteGuard from '@/components/layout/route-guard';
import Sku3dUploadStatusTemplate from '@/features/inventory/sku-3d-models/upload-status-template';

export default function Page() {
  return (
    <RouteGuard screen="/inventory/sku-3d-models">
      <Sku3dUploadStatusTemplate />
    </RouteGuard>
  );
}
