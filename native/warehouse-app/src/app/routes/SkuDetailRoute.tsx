import { useParams } from '@tanstack/react-router';
import { SkuDetailScreen } from '../../domains/inventory/SkuDetailScreen';

export function SkuDetailRoute() {
  const { sku } = useParams({ strict: false });
  return <SkuDetailScreen skuId={sku ?? ''} />;
}
