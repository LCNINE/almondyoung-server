'use client';

import * as React from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/ui';

export interface SearchFilterPanelProps {
  children: React.ReactNode;
  onSearch: () => void;
  onReset: () => void;
  className?: string;
}

/**
 * 라벨 행을 쌓고 하단 검색 버튼으로 한 번에 제출하는 필터 패널.
 * DataTable 의 즉시반영 `DataTableFilter` 와 달리 검색을 눌러야 URL 이 바뀐다.
 */
export function SearchFilterPanel({
  children,
  onSearch,
  onReset,
  className,
}: SearchFilterPanelProps) {
  return (
    <div
      className={cn(
        'mb-4 space-y-3 rounded-[10px] border border-[#D9D9D9] bg-[#F5F5F5] p-4',
        className
      )}
    >
      {children}

      <div className="flex justify-center gap-2 pt-1">
        <Button
          onClick={onSearch}
          className="h-9 w-28 bg-orange-500 text-white hover:bg-orange-600"
        >
          <Search className="mr-1.5 h-4 w-4" />
          검색
        </Button>
        <Button variant="outline" onClick={onReset} className="h-9 w-20">
          초기화
        </Button>
      </div>
    </div>
  );
}

export interface FilterRowProps {
  label: string;
  children: React.ReactNode;
}

/** 좌측 고정폭 라벨 + 우측 컨트롤 한 줄. */
export function FilterRow({ label, children }: FilterRowProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="w-20 shrink-0 text-sm text-[#333]">{label}</span>
      <div className="flex flex-1 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
