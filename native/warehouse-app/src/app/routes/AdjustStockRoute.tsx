import { useParams, useSearch } from '@tanstack/react-router';
import { AdjustStockScreen } from '../../domains/inventory/AdjustStockScreen';

export function AdjustStockRoute() {
  const { sku } = useParams({ strict: false });
  const search: { locationId?: string } = useSearch({ strict: false });
  return <AdjustStockScreen skuId={sku ?? ''} initialLocationId={search.locationId} />;
}
