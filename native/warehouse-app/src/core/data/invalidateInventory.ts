import type { QueryClient } from '@tanstack/react-query';
/** A confirmed write stays confirmed even when refreshing a read model fails. */
export function invalidateInventory(client: QueryClient) {
  const roots = [
    'location-contents',
    'sku-warehouse-stock',
    'sku-stock-summary',
    'expected-arrivals',
    'inbound-receipts',
    'putaway-pending',
    'outbound-batches',
    'stocktaking-session',
    'stocktaking-variances',
    'stocktaking-sessions',
  ];
  void Promise.allSettled(
    roots.map((key) => client.invalidateQueries({ queryKey: [key] }))
  );
}
