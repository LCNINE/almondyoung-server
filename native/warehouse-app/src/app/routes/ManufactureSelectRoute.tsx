import { useParams } from '@tanstack/react-router';
import { AdjustStockScreen } from '../../domains/inventory/AdjustStockScreen';
import { ManufactureSelectScreen } from '../../domains/inventory/ManufactureSelectScreen';

export function ManufactureSelectRoute() {
  return <ManufactureSelectScreen />;
}

export function ManufactureAdjustRoute() {
  const { sku } = useParams({ strict: false });

  return <AdjustStockScreen skuId={sku ?? ''} mode="manufacture" />;
}
