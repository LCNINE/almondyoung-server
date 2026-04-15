'use client';

import { GripVertical } from 'lucide-react';
import { flexRender, type Row } from '@tanstack/react-table';
import { Table } from '@/components/admin-ui-experimental/common/table/table';
import type { Category } from '@/lib/types/ui/products';
import { cn } from '@/lib/utils/ui';

interface DraggableCategoryRowProps {
  row: Row<Category>;
  dragProps: {
    draggable: boolean;
    onDragStart: (e: React.DragEvent<HTMLTableRowElement>) => void;
    onDragOver: (e: React.DragEvent<HTMLTableRowElement>) => void;
    onDragLeave: (e: React.DragEvent<HTMLTableRowElement>) => void;
    onDrop: (e: React.DragEvent<HTMLTableRowElement>) => void;
    onDragEnd: () => void;
  };
  className?: string;
}

export function DraggableCategoryRow({
  row,
  dragProps,
  className,
}: DraggableCategoryRowProps) {
  return (
    <Table.Row
      {...dragProps}
      className={cn('group cursor-move', className)}
    >
      <Table.Cell className="w-8 px-1">
        <div className="flex items-center justify-center text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing">
          <GripVertical size={16} />
        </div>
      </Table.Cell>
      {row.getVisibleCells().map((cell) => (
        <Table.Cell key={cell.id}>
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </Table.Cell>
      ))}
    </Table.Row>
  );
}
