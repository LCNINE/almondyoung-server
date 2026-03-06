// src/components/ui/pagination.tsx
'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
  onPageChange: (page: number) => void;
  onItemsPerPageChange?: (itemsPerPage: number) => void;
  showItemsPerPage?: boolean;
  className?: string;
}

export function Pagination({
  currentPage,
  totalPages,
  totalItems,
  itemsPerPage,
  onPageChange,
  onItemsPerPageChange,
  showItemsPerPage = true,
  className = '',
}: PaginationProps) {
  const startItem = totalItems > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0;
  const endItem = totalItems > 0 ? Math.min(currentPage * itemsPerPage, totalItems) : 0;

  const getVisiblePages = () => {
    if (totalPages <= 1) return [1];
    const delta = 2;
    const range: (number | string)[] = [];
    const rangeWithDots: (number | string)[] = [];

    for (let i = Math.max(2, currentPage - delta); i <= Math.min(totalPages - 1, currentPage + delta); i++) {
      range.push(i);
    }

    if (currentPage - delta > 2) {
      rangeWithDots.push(1, '...');
    } else {
      rangeWithDots.push(1);
    }

    rangeWithDots.push(...range);

    if (currentPage + delta < totalPages - 1) {
      rangeWithDots.push('...', totalPages);
    } else if (totalPages > 1) {
      rangeWithDots.push(totalPages);
    }

    return rangeWithDots;
  };

  const visiblePages = getVisiblePages();

  return (
    <div className={`flex items-center justify-between bg-white px-4 py-3 border-t border-gray-200 ${className}`}>
      {/* 페이지 정보 */}
      <div className="flex items-center space-x-4">
        <div className="text-sm text-gray-700 font-medium">
          {totalItems > 0 ? (
            <>
              총 <span className="font-bold text-gray-900">{totalItems.toLocaleString()}</span>개 중{' '}
              <span className="font-bold text-gray-900">{startItem.toLocaleString()}</span>-
              <span className="font-bold text-gray-900">{endItem.toLocaleString()}</span>개 표시
            </>
          ) : (
            <>데이터 없음</>
          )}
        </div>

        {showItemsPerPage && onItemsPerPageChange && (
          <div className="flex items-center space-x-2">
            <span className="text-sm text-gray-700 font-medium">페이지당:</span>
            <Select
              value={itemsPerPage.toString()}
              onValueChange={(value) => onItemsPerPageChange(Number(value))}
            >
              <SelectTrigger className="w-20 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 20, 50, 100].map((num) => (
                  <SelectItem key={num} value={num.toString()}>
                    {num}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* 페이지네이션 버튼 */}
      <div className="flex items-center space-x-1">
        {/* 첫 페이지 */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(1)}
          disabled={currentPage === 1 || totalPages <= 1}
          className="h-8 w-8 p-0 text-sm"
        >
          <ChevronsLeft className="h-4 w-4" />
        </Button>

        {/* 이전 페이지 */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1 || totalPages <= 1}
          className="h-8 w-8 p-0 text-sm"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        {/* 페이지 번호들 */}
        {visiblePages.map((page, index) => (
          <React.Fragment key={index}>
            {page === '...' ? (
              <span className="px-2 py-1 text-gray-500 text-sm">...</span>
            ) : (
              <Button
                variant={currentPage === page ? 'default' : 'outline'}
                size="sm"
                onClick={() => onPageChange(page as number)}
                className={`h-8 w-8 p-0 text-sm font-medium ${currentPage === page
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'text-gray-700 hover:text-gray-900 hover:bg-gray-50'
                  }`}
              >
                {page}
              </Button>
            )}
          </React.Fragment>
        ))}

        {/* 다음 페이지 */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages || totalPages <= 1}
          className="h-8 w-8 p-0 text-sm"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>

        {/* 마지막 페이지 */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage === totalPages || totalPages <= 1}
          className="h-8 w-8 p-0 text-sm"
        >
          <ChevronsRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
