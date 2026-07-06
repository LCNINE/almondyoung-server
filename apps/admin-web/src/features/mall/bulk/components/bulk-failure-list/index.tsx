import type { BulkUpdateFailureDto } from '@/lib/types/dto/products';

export function BulkFailureList({ items }: { items: BulkUpdateFailureDto[] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-3">
      <p className="text-sm font-medium text-destructive">
        실패한 상품 ({items.length}개)
      </p>
      <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-muted-foreground">
        {items.map((item) => (
          <li key={item.masterId}>
            <span className="font-medium text-foreground">
              {item.name ?? item.masterId}
            </span>{' '}
            — {item.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}
