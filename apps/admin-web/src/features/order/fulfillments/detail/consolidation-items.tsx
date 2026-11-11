import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ConsolidationItem } from '@/lib/types/dto/fulfillment';
import { cn } from '@/lib/utils/ui';
import { itemsTotalText, type MergedItem } from './consolidation-sheet-model';

// 버튼 안에도 들어가므로 span 으로 목록을 만든다.
export function ConsolidationItemList({
  id,
  label,
  items,
  className,
}: {
  id?: string;
  label: string;
  items: readonly ConsolidationItem[];
  className?: string;
}) {
  return (
    <span
      id={id}
      role="list"
      aria-label={label}
      className={cn('flex flex-col gap-0.5 text-sm', className)}
    >
      {items.map((item) => (
        <span
          key={item.skuId}
          role="listitem"
          className="flex justify-between gap-3"
        >
          <span className="min-w-0 break-words">{item.name}</span>{' '}
          <span className="shrink-0 font-medium tabular-nums">
            {item.qty}개
          </span>
        </span>
      ))}
    </span>
  );
}

export function MergedItemsTable({ items }: { items: readonly MergedItem[] }) {
  return (
    <div className="rounded-lg border">
      <Table aria-label="합친 상자에 담길 상품">
        <TableHeader>
          <TableRow>
            <TableHead>상품</TableHead>
            <TableHead>주문별</TableHead>
            <TableHead className="text-right">합친 수량</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.skuId}>
              <TableCell className="whitespace-normal">{item.name}</TableCell>
              <TableCell className="whitespace-normal text-xs text-muted-foreground">
                {item.parts
                  .map((part) => `${part.label} ${part.qty}개`)
                  .join(' + ')}
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums">
                {item.qty}개
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={2}>합계</TableCell>
            <TableCell className="text-right font-semibold tabular-nums">
              {itemsTotalText(items)}
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}
