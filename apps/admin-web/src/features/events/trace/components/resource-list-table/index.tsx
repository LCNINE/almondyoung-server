'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Pagination } from '@/components/common/pagination';
import { Loader2 } from 'lucide-react';

interface ResourceListTableProps {
  resources: { resourceId: string }[];
  total: number;
  isLoading: boolean;
  page: number;
  limit: number;
  onPageChange: (page: number) => void;
  onLimitChange?: (limit: number) => void;
}

export function ResourceListTable({
  resources,
  total,
  isLoading,
  page,
  limit,
  onPageChange,
  onLimitChange,
}: ResourceListTableProps) {
  const totalPages = Math.max(1, Math.ceil(total / limit));

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!isLoading && resources.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-gray-500">
        데이터가 없습니다.
      </div>
    );
  }

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">#</TableHead>
            <TableHead>Resource ID</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {resources.map((r, idx) => (
            <TableRow key={r.resourceId}>
              <TableCell className="text-gray-500 text-sm">
                {(page - 1) * limit + idx + 1}
              </TableCell>
              <TableCell className="font-mono text-sm">{r.resourceId}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pagination
        currentPage={page}
        totalPages={totalPages}
        totalItems={total}
        itemsPerPage={limit}
        onPageChange={onPageChange}
        onItemsPerPageChange={onLimitChange}
        showItemsPerPage={!!onLimitChange}
      />
    </div>
  );
}
